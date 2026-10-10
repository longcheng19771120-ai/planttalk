import {
  selectIsConnecting,
  selectIsHardwareConnected,
  selectIsSerialSupported,
  selectSensorReadings,
  selectUsesFallback,
  usePlantSensorsStore,
} from "@/stores/plant/sensors-store";
import { describeLightReading } from "@/lib/plant/sensors";
import { lightLabel } from "@/lib/plant/labels";
import { formatSensorValue, plantSensorFields } from "@/lib/plant/plants";
import { actionGlyph, type ActionStatus } from "@/components/dashboard/action-glyph";
import { ARDUINO_CHECK_INTERVAL_LIMITS, usePlantSettingsStore } from "@/stores/plant/settings-store";

export function SensorsPanel() {
  const isConnecting = usePlantSensorsStore(selectIsConnecting);
  const isHardwareConnected = usePlantSensorsStore(selectIsHardwareConnected);
  const isSerialSupported = usePlantSensorsStore(selectIsSerialSupported);
  const sensorReadings = usePlantSensorsStore(selectSensorReadings);
  const sensorMode = usePlantSensorsStore((s) => s.sensorMode);
  const statusMessage = usePlantSensorsStore((s) => s.statusMessage);
  const usesFallback = usePlantSensorsStore(selectUsesFallback);
  const setSensorMode = usePlantSensorsStore((s) => s.setSensorMode);
  const connect = usePlantSensorsStore((s) => s.connect);
  const disconnect = usePlantSensorsStore((s) => s.disconnect);
  const setFallbackSensorValue = usePlantSensorsStore((s) => s.setFallbackSensorValue);
  const sendCommand = usePlantSensorsStore((s) => s.sendCommand);

  const arduinoCheckIntervalMs = usePlantSettingsStore((s) => s.arduinoCheckIntervalMs);
  const setArduinoCheckIntervalMs = usePlantSettingsStore((s) => s.setArduinoCheckIntervalMs);

  // The Arduino only learns its reporting rate over serial, so changing the
  // setting while connected must also send the command (it is otherwise only
  // sent once at connect time).
  const applyArduinoInterval = (value: number) => {
    setArduinoCheckIntervalMs(value);
    if (isHardwareConnected) {
      void sendCommand(`interval ${usePlantSettingsStore.getState().arduinoCheckIntervalMs}`);
    }
  };

  const isArduinoMode = sensorMode === "arduino";

  const status: ActionStatus =
    sensorMode === "manual" ? "done" : isHardwareConnected ? "done" : isConnecting ? "working" : "todo";
  const modeLabel =
    sensorMode === "manual"
      ? "手动滑块"
      : isHardwareConnected && !usesFallback
        ? "Arduino 实时数据"
        : "Arduino 模式";

  return (
    <article>
      <header>
        {actionGlyph(status)} <strong>传感器</strong>{" "}
        <small>（{modeLabel}）</small>
      </header>

      <fieldset>
        <legend>传感器模式</legend>
        <label>
          <input
            type="radio"
            name="sensor-mode"
            checked={sensorMode === "manual"}
            onChange={() => void setSensorMode("manual")}
          />
          手动滑块
        </label>
        <label>
          <input
            type="radio"
            name="sensor-mode"
            checked={sensorMode === "arduino"}
            onChange={() => void setSensorMode("arduino")}
          />
          Arduino 传感器
        </label>
      </fieldset>

      <p>
        土壤湿度：<strong>{Math.round(sensorReadings.moisture)}%</strong>
        <progress value={sensorReadings.moisture} max={100} />
        光照：<strong>{lightLabel(describeLightReading(sensorReadings.light))}</strong>
      </p>

      <p>
        <small>{statusMessage}</small>
      </p>

      {sensorMode === "manual" ? (
        <>
          {plantSensorFields.map((field) => (
            <label key={field.key}>
              {field.label}：{formatSensorValue(sensorReadings[field.key], field.unit, field.step)}
              <input
                type="range"
                min={field.min}
                max={field.max}
                step={field.step}
                value={sensorReadings[field.key]}
                onChange={(event) => setFallbackSensorValue(field.key, Number(event.target.value))}
              />
              <small>{field.helper}</small>
            </label>
          ))}
        </>
      ) : usesFallback ? (
        <p>
          <small>连接 Arduino 以使用实时读数，或切换回手动滑块。</small>
        </p>
      ) : (
        <label>
          上报间隔：{arduinoCheckIntervalMs} 毫秒
          <input
            type="range"
            min={ARDUINO_CHECK_INTERVAL_LIMITS.min}
            max={ARDUINO_CHECK_INTERVAL_LIMITS.max}
            step={ARDUINO_CHECK_INTERVAL_LIMITS.step}
            value={arduinoCheckIntervalMs}
            onChange={(event) => applyArduinoInterval(Number(event.target.value))}
          />
          <small>Arduino 通过串口发送一次传感器数据的频率。</small>
        </label>
      )}

      {isArduinoMode && (
        <footer>
          <button
            type="button"
            className="secondary"
            disabled={!isSerialSupported || isConnecting}
            aria-busy={isConnecting}
            onClick={isHardwareConnected ? disconnect : connect}
          >
            {isHardwareConnected ? "断开 Arduino" : "连接 Arduino"}
          </button>
        </footer>
      )}
    </article>
  );
}
