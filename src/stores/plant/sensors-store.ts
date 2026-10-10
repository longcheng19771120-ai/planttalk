import { create } from "zustand";
import { usePlantSettingsStore } from "@/stores/plant/settings-store";
import {
  DEFAULT_PLANT_SENSOR_READINGS,
  PLANT_SENSOR_LIMITS,
  type PlantSensorKey,
  type PlantSensorReadings,
} from "@/lib/plant/sensors";

export {
  DEFAULT_PLANT_SENSOR_READINGS,
  PLANT_SENSOR_LIMITS,
  type PlantSensorKey,
  type PlantSensorReadings,
} from "@/lib/plant/sensors";

interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
}

interface SerialLike {
  requestPort: () => Promise<SerialPortLike>;
  getPorts?: () => Promise<SerialPortLike[]>;
  addEventListener?: (event: string, handler: (e: Event) => void) => void;
}

type ConnectionState = "unsupported" | "disconnected" | "connecting" | "connected";
export type SensorMode = "manual" | "arduino";

const SERIAL_BAUD_RATE = 115200;
const RECONNECT_INTERVAL_MS = 3000;
const STARTUP_GRACE_MS = 20_000; // Arduino boot time before watchdog kicks in
const SENSOR_MODE_STORAGE_KEY = "plant-sensors/mode";

const SENSOR_ALIASES: Record<PlantSensorKey, string[]> = {
  moisture: ["moisture", "soil", "soilMoisture", "moisturePercent"],
  light: ["light", "ambientLight", "ambient_light", "lux"],
};

interface PlantSensorsState {
  sensorMode: SensorMode;
  fallbackReadings: PlantSensorReadings;
  hardwareReadings: PlantSensorReadings;
  lastHardwareReadingAt: number | null;
  lastFallbackAdjustmentAt: number | null;
  connectionState: ConnectionState;
  statusMessage: string;

  setSensorMode: (mode: SensorMode) => Promise<void>;
  setFallbackSensorValue: (key: PlantSensorKey, value: number) => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  sendCommand: (cmd: string) => Promise<void>;
  init: () => void;
  cleanup: () => Promise<void>;
}

export const usePlantSensorsStore = create<PlantSensorsState>()((set) => {
  let port: SerialPortLike | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let writer: WritableStreamDefaultWriter<string> | null = null;
  let reconnectTimer: ReturnType<typeof setInterval> | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let pipeAbortController: AbortController | null = null;
  let openInProgress = false;
  // Set when the user clicks Disconnect. While true, none of the auto-reconnect
  // paths (poll timer, USB connect event, read-loop teardown) may bring the
  // Arduino back — a manual disconnect stays disconnected until an explicit connect.
  let suppressAutoReconnect = false;

  function updateConnection(nextState: ConnectionState, nextMessage: string) {
    set({ connectionState: nextState, statusMessage: nextMessage });
  }

  function setStoredSensorMode(mode: SensorMode) {
    set({ sensorMode: mode });
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SENSOR_MODE_STORAGE_KEY, mode);
    }
  }

  function isArduinoMode() {
    return usePlantSensorsStore.getState().sensorMode === "arduino";
  }

  async function sendSerialCommand(cmd: string) {
    if (!writer) return;

    try {
      await writer.write(`${cmd}\n`);
    } catch {
      // ignore write errors
    }
  }

  function syncArduinoCheckInterval() {
    const { arduinoCheckIntervalMs } = usePlantSettingsStore.getState();
    void sendSerialCommand(`interval ${arduinoCheckIntervalMs}`);
  }

  function applyHardwarePayload(payload: Partial<PlantSensorReadings> | null) {
    if (!payload) return;

    set((state) => {
      let hasChanges = false;
      let hasValidValue = false;
      const next = { ...state.hardwareReadings };

      for (const [key, value] of Object.entries(payload) as Array<[PlantSensorKey, number | undefined]>) {
        if (typeof value !== "number" || Number.isNaN(value)) continue;
        hasValidValue = true;

        const limits = PLANT_SENSOR_LIMITS[key];
        const normalizedValue = clamp(value, limits.min, limits.max);

        if (next[key] !== normalizedValue) {
          next[key] = normalizedValue;
          hasChanges = true;
        }
      }

      if (!hasValidValue) {
        return {};
      }

      return {
        hardwareReadings: hasChanges ? next : state.hardwareReadings,
        lastHardwareReadingAt: Date.now(),
      };
    });
  }

  function stopReconnecting() {
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function resetWatchdog(overrideTimeoutMs?: number) {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    // Use the current sensor interval + a generous grace period so the watchdog never
    // fires before data can arrive (avoids spurious reconnects when serial is slightly slow).
    const { arduinoCheckIntervalMs } = usePlantSettingsStore.getState();
    const timeout = overrideTimeoutMs ?? Math.max(arduinoCheckIntervalMs * 3, arduinoCheckIntervalMs + 8000);
    watchdogTimer = setTimeout(() => {
      // Before forcing a reconnect, check if we got a valid hardware reading recently.
      // The UI may have updated from a reading that arrived just before the watchdog window.
      const { lastHardwareReadingAt } = usePlantSensorsStore.getState();
      const timeSinceLastReading = lastHardwareReadingAt ? Date.now() - lastHardwareReadingAt : Infinity;

      if (timeSinceLastReading < timeout) {
        // A valid reading arrived within the watchdog window — reset instead of reconnecting.
        console.info(
          "[sensors] Watchdog: recent reading",
          Math.round(timeSinceLastReading),
          "ms ago — resetting timer",
        );
        resetWatchdog();
        return;
      }

      console.warn("[sensors] Watchdog: no data received in", timeout, "ms — forcing reconnect");
      watchdogTimer = null;
      void closePort("Arduino 无响应——正在重新连接…").then(() => {
        startReconnecting();
      });
    }, timeout);
  }

  function stopWatchdog() {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function startReconnecting() {
    if (suppressAutoReconnect || !isArduinoMode()) return;
    stopReconnecting();
    reconnectTimer = setInterval(() => {
      const serial = getSerialApi();
      if (!serial) {
        stopReconnecting();
        return;
      }

      void (async () => {
        const ports = (await serial.getPorts?.()) ?? [];
        if (ports.length === 0) return;

        // If a connection attempt is already in flight, leave the interval
        // running so we retry next tick instead of silently stopping.
        if (openInProgress) return;

        stopReconnecting();
        updateConnection("connecting", "正在重新连接 Arduino…");
        try {
          await connectToPort(ports[0], "Arduino 已重新连接，正在读取实时传感器数据。");
        } catch {
          startReconnecting();
        }
      })();
    }, RECONNECT_INTERVAL_MS);
  }

  async function closePort(reason: string) {
    stopWatchdog();

    const currentPipeAbort = pipeAbortController;
    pipeAbortController = null;
    if (currentPipeAbort) currentPipeAbort.abort();

    const currentReader = reader;
    reader = null;

    if (currentReader) {
      try {
        await currentReader.cancel();
      } catch {
        // ignore cancellation errors while tearing down
      }

      try {
        currentReader.releaseLock();
      } catch {
        // ignore release errors after stream shutdown
      }
    }

    const currentWriter = writer;
    writer = null;

    if (currentWriter) {
      try {
        await currentWriter.close();
      } catch {
        // ignore close errors during teardown
      }
    }

    const currentPort = port;
    port = null;

    if (currentPort) {
      try {
        await currentPort.close();
      } catch {
        // ignore close errors if the port is already gone
      }
    }

    updateConnection("disconnected", reason);
  }

  async function connectToPort(nextPort: SerialPortLike, readyMessage: string) {
    if (openInProgress) return;
    openInProgress = true;

    try {
      await closePort("Arduino 传感器模式。连接 Arduino 以使用实时读数。");

      try {
        await nextPort.open({ baudRate: SERIAL_BAUD_RATE });
      } catch (openError) {
        // Physical disconnection can leave the port internally "open" in the browser.
        // Close it and retry once.
        if (openError instanceof DOMException && openError.name === "InvalidStateError") {
          try {
            await nextPort.close();
          } catch {}
          try {
            await nextPort.open({ baudRate: SERIAL_BAUD_RATE });
          } catch (retryError) {
            throw describeOpenError(retryError);
          }
        } else {
          throw describeOpenError(openError);
        }
      }

      const nextReader = nextPort.readable?.getReader();

      if (!nextReader) {
        await nextPort.close();
        throw new Error("Arduino 已连接，但没有可读取的串口数据流。");
      }

      if (nextPort.writable) {
        try {
          const encoderStream = new TextEncoderStream();
          const abort = new AbortController();
          pipeAbortController = abort;
          encoderStream.readable.pipeTo(nextPort.writable, { signal: abort.signal }).catch(() => {});
          writer = encoderStream.writable.getWriter();
        } catch {
          // write unavailable — continue read-only
        }
      }

      port = nextPort;
      reader = nextReader;
      openInProgress = false;
      updateConnection("connected", readyMessage);
      syncArduinoCheckInterval();
      // Give the Arduino time to finish booting before the watchdog starts checking.
      resetWatchdog(STARTUP_GRACE_MS);

      void (async () => {
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          for (;;) {
            const { value, done } = await nextReader.read();

            if (done) break;

            resetWatchdog(); // Data received — Arduino is alive
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop()!;

            for (const line of lines) {
              applyHardwarePayload(parseSensorPayload(line));
            }
          }

          if (buffer.trim()) {
            applyHardwarePayload(parseSensorPayload(buffer));
          }

          if (!suppressAutoReconnect) {
            updateConnection("disconnected", "Arduino 数据流已结束——正在重新连接…");
            startReconnecting();
          }
        } catch (error) {
          if (isAbortError(error) || suppressAutoReconnect) {
            // User-initiated close — closePort/disconnect already set the message.
          } else {
            updateConnection("disconnected", "Arduino 连接断开——正在重新连接…");
            startReconnecting();
          }
        } finally {
          try {
            nextReader.releaseLock();
          } catch {
            // ignore release errors after reader shutdown
          }

          if (reader === nextReader) {
            reader = null;
          }

          if (port === nextPort) {
            port = null;

            try {
              await nextPort.close();
            } catch {
              // ignore close errors during teardown
            }
          }
        }
      })();
    } catch (setupError) {
      openInProgress = false;
      throw setupError;
    }
  }

  return {
    sensorMode: readInitialSensorMode(),
    fallbackReadings: DEFAULT_PLANT_SENSOR_READINGS,
    hardwareReadings: DEFAULT_PLANT_SENSOR_READINGS,
    lastHardwareReadingAt: null,
    lastFallbackAdjustmentAt: null,
    connectionState: "disconnected",
    statusMessage: "手动传感器模式。调整滑块，或切换到 Arduino 传感器。",

    setSensorMode: async (mode) => {
      setStoredSensorMode(mode);

      if (mode === "manual") {
        suppressAutoReconnect = true;
        stopReconnecting();
        await closePort("手动传感器模式。调整滑块来设置植物读数。");
        return;
      }

      const serial = getSerialApi();

      if (!serial) {
        updateConnection("unsupported", "Arduino 传感器模式需要支持 Web Serial 的 Chrome 或 Edge。");
        return;
      }

      suppressAutoReconnect = false;
      updateConnection("disconnected", "Arduino 传感器模式。连接 Arduino 以使用实时读数。");

      try {
        const rememberedPorts = (await serial.getPorts?.()) ?? [];
        if (rememberedPorts.length > 0) {
          updateConnection("connecting", "正在重新连接已记住的 Arduino…");
          await connectToPort(rememberedPorts[0], "Arduino 已重新连接，正在读取实时传感器数据。");
        }
      } catch {
        updateConnection("disconnected", "Arduino 传感器模式。连接 Arduino 以使用实时读数。");
      }
    },

    setFallbackSensorValue: (key, value) => {
      const limits = PLANT_SENSOR_LIMITS[key];
      set((state) => ({
        fallbackReadings: {
          ...state.fallbackReadings,
          [key]: clamp(value, limits.min, limits.max),
        },
        lastFallbackAdjustmentAt: Date.now(),
      }));
    },

    connect: async () => {
      const serial = getSerialApi();
      setStoredSensorMode("arduino");

      if (!serial) {
        updateConnection("unsupported", "Arduino 传感器模式需要支持 Web Serial 的 Chrome 或 Edge。");
        return;
      }

      // An explicit connect clears any prior manual-disconnect suppression.
      suppressAutoReconnect = false;
      stopReconnecting();
      updateConnection("connecting", "等待 Arduino 串口授权…");

      try {
        const nextPort = await serial.requestPort();
        await connectToPort(nextPort, "Arduino 已连接，正在读取实时传感器数据。");
      } catch (error) {
        if (isAbortError(error)) {
          updateConnection("disconnected", "已取消选择 Arduino。请切换到手动模式或重试。");
          return;
        }

        updateConnection(
          "disconnected",
          error instanceof Error ? error.message : "无法连接 Arduino。请切换到手动模式或重试。",
        );
      }
    },

    disconnect: async () => {
      // Honor the user's intent: stay disconnected until they connect again.
      suppressAutoReconnect = true;
      stopReconnecting();
      await closePort("Arduino 已断开。请切换到手动模式或重新连接 Arduino。");
    },

    sendCommand: sendSerialCommand,

    init: () => {
      const serial = getSerialApi();

      if (!serial) {
        updateConnection("unsupported", "此处可用手动传感器模式。Arduino 模式需要 Chrome 或 Edge。");
        return;
      }

      updateConnection(
        "disconnected",
        isArduinoMode()
          ? "Arduino 传感器模式。连接 Arduino 以使用实时读数。"
          : "手动传感器模式。调整滑块，或切换到 Arduino 传感器。",
      );

      serial.addEventListener?.("connect", () => {
        // USB device plugged in — auto-connect if we're not already connected,
        // unless the user deliberately disconnected.
        if (suppressAutoReconnect || !isArduinoMode()) return;
        void (async () => {
          const ports = (await serial.getPorts?.()) ?? [];
          if (ports.length === 0) return;

          stopReconnecting();
          updateConnection("connecting", "检测到 USB 设备——正在连接…");
          try {
            await connectToPort(ports[0], "Arduino 已连接，正在读取实时传感器数据。");
          } catch {
            updateConnection("disconnected", "Arduino 传感器模式。连接 Arduino 以使用实时读数。");
          }
        })();
      });

      serial.addEventListener?.("disconnect", () => {
        // The read loop will detect the failure and start reconnecting.
        // Update the status immediately so the UI reflects the drop.
        if (port) {
          updateConnection("disconnected", "Arduino 已断开——正在重新连接…");
        }
      });

      void (async () => {
        if (!isArduinoMode()) return;

        try {
          const rememberedPorts = (await serial.getPorts?.()) ?? [];

          if (rememberedPorts.length === 0) return;

          const rememberedPort = rememberedPorts[0];
          updateConnection("connecting", "正在重新连接已记住的 Arduino…");
          await connectToPort(rememberedPort, "Arduino 已重新连接，正在读取实时传感器数据。");
        } catch {
          updateConnection("disconnected", "Arduino 传感器模式。连接 Arduino 以使用实时读数。");
        }
      })();
    },

    cleanup: async () => {
      stopReconnecting();
      await closePort("Arduino 已断开。");
    },
  };
});

// Selectors

// Hardware readings only count while Arduino mode is selected, the board is
// connected, and at least one live reading has arrived. Otherwise the active
// reading source is the manual sliders.
function hasUsableHardwareReadings(state: PlantSensorsState) {
  return state.sensorMode === "arduino" && state.connectionState === "connected" && state.lastHardwareReadingAt !== null;
}

export function selectSensorReadings(state: PlantSensorsState) {
  if (hasUsableHardwareReadings(state)) return state.hardwareReadings;
  return state.fallbackReadings;
}

export function selectIsConnecting(state: PlantSensorsState) {
  return state.connectionState === "connecting";
}

export function selectIsHardwareConnected(state: PlantSensorsState) {
  return state.connectionState === "connected";
}

export function selectIsSerialSupported(state: PlantSensorsState) {
  return state.connectionState !== "unsupported";
}

export function selectUsesFallback(state: PlantSensorsState) {
  return !hasUsableHardwareReadings(state);
}

export function selectHasFreshHardwareReadings(state: PlantSensorsState) {
  return hasUsableHardwareReadings(state);
}

export function selectHasAdjustedFallbackReadings(state: PlantSensorsState) {
  return state.lastFallbackAdjustmentAt !== null;
}

// Utilities

function getSerialApi(): SerialLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { serial?: SerialLike }).serial ?? null;
}

function readInitialSensorMode(): SensorMode {
  if (typeof localStorage === "undefined") return "manual";
  return localStorage.getItem(SENSOR_MODE_STORAGE_KEY) === "arduino" ? "arduino" : "manual";
}

function parseSensorPayload(payload: string): Partial<PlantSensorReadings> | null {
  const trimmedPayload = payload.trim();

  if (!trimmedPayload) return null;

  try {
    const parsedJson = JSON.parse(trimmedPayload) as Record<string, unknown>;
    return scaleHardwareFractions(normalizeSensorRecord(parsedJson));
  } catch {
    // fall through to key-value and CSV parsing
  }

  const csvValues = trimmedPayload
    .split(",")
    .map((value) => toFiniteNumber(value.trim()))
    .filter((value): value is number => typeof value === "number");

  if (csvValues.length === 2) {
    return scaleHardwareFractions({
      moisture: csvValues[0],
      light: csvValues[1],
    });
  }

  const pairs = trimmedPayload
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const record: Record<string, unknown> = {};

  for (const pair of pairs) {
    const [rawKey, ...rawValueParts] = pair.split(/[:=]/);

    if (rawValueParts.length === 0) continue;

    record[rawKey.trim()] = rawValueParts.join(":").trim();
  }

  return scaleHardwareFractions(normalizeSensorRecord(record));
}

function normalizeSensorRecord(input: Record<string, unknown>): Partial<PlantSensorReadings> | null {
  const normalized: Partial<PlantSensorReadings> = {};

  for (const [sensorKey, aliases] of Object.entries(SENSOR_ALIASES) as Array<[PlantSensorKey, string[]]>) {
    const matchingAlias = aliases.find((alias) => alias in input);

    if (!matchingAlias) continue;

    const nextValue = toFiniteNumber(input[matchingAlias]);

    if (typeof nextValue === "number") {
      normalized[sensorKey] = nextValue;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

// The bundled Arduino sketch sends readings as normalized 0–1 fractions, but
// hand-rolled firmware often sends 0–100 percentages. Scale only values that
// look like fractions so both styles work.
function scaleHardwareFractions(readings: Partial<PlantSensorReadings> | null): Partial<PlantSensorReadings> | null {
  if (!readings) return null;
  const scaled = { ...readings };
  if (typeof scaled.moisture === "number" && scaled.moisture <= 1) scaled.moisture *= 100;
  if (typeof scaled.light === "number" && scaled.light <= 1) scaled.light *= 100;
  return scaled;
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  return null;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

// Opening a serial port fails with a generic browser error when the port is
// already held elsewhere — most often another tab or a Serial Monitor that is
// still connected. Turn that into an actionable message instead of a silent or
// cryptic failure.
function describeOpenError(error: unknown): Error {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");
  const looksBusy =
    (error instanceof DOMException &&
      (error.name === "NetworkError" || error.name === "InvalidStateError")) ||
    /failed to open|access|in use|busy|already open/i.test(rawMessage);

  if (looksBusy) {
    return new Error(
      "无法打开 Arduino——串口已被占用。请关闭运行此应用的其他浏览器标签页，" +
        "并退出 Arduino IDE 串口监视器或其他串口程序，然后重试。",
    );
  }

  return new Error(
    rawMessage
      ? `无法打开 Arduino：${rawMessage}`
      : "无法打开 Arduino。请检查数据线后重试，或切换到手动滑块。",
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
