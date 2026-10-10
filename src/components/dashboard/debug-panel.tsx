import { useObservationLoopStore } from "@/stores/plant/observation-loop-store";
import { usePlantCameraStore, type LiveCameraStatus } from "@/stores/plant/camera-store";
import { selectUsesFallback, usePlantSensorsStore } from "@/stores/plant/sensors-store";

// Status glyphs used across the debug rows:
//   ✅ healthy/ready   ⏳ waiting/working   🎚️ manual sliders
//   💤 idle/not started   ⚠️ unsupported   ❌ error/offline
function serialStatus(state: string): [string, string] {
  if (state === "connected") return ["✅", "已连接"];
  if (state === "connecting") return ["⏳", "连接中…"];
  if (state === "unsupported") return ["⚠️", "不支持 Web Serial"];
  return ["🎚️", "未连接"];
}

function cameraStatusGlyph(status: LiveCameraStatus): [string, string] {
  switch (status) {
    case "ready":
      return ["✅", "就绪"];
    case "starting":
      return ["⏳", "启动中…"];
    case "error":
      return ["❌", "出错"];
    case "unsupported":
      return ["⚠️", "不支持"];
    default:
      return ["💤", "空闲"];
  }
}

export function DebugPanel() {
  const sensorMode = usePlantSensorsStore((s) => s.sensorMode);
  const connectionState = usePlantSensorsStore((s) => s.connectionState);
  const statusMessage = usePlantSensorsStore((s) => s.statusMessage);
  const lastHardwareReadingAt = usePlantSensorsStore((s) => s.lastHardwareReadingAt);
  const usesFallback = usePlantSensorsStore(selectUsesFallback);
  const cameraStatus = usePlantCameraStore((s) => s.cameraStatus);
  const modelLabel = useObservationLoopStore((s) => s.modelLabel);
  const lastUpdatedAt = useObservationLoopStore((s) => s.lastUpdatedAt);
  const isSubmitting = useObservationLoopStore((s) => s.isSubmitting);
  const observeError = useObservationLoopStore((s) => s.errorMessage);

  const [serialGlyph, serialLabel] = serialStatus(connectionState);
  const [camGlyph, camLabel] = cameraStatusGlyph(cameraStatus);
  const online = typeof navigator !== "undefined" && navigator.onLine;

  const [apiGlyph, apiLabel] = isSubmitting
    ? ["⏳", "观察中…"]
    : observeError
      ? ["❌", observeError]
      : lastUpdatedAt
        ? ["✅", `${modelLabel}，${lastUpdatedAt.toLocaleTimeString()}`]
        : ["💤", modelLabel];

  return (
    <article>
      <header>
        <strong>调试</strong>
      </header>

      <table>
        <tbody>
          <tr>
            <td>串口连接</td>
            <td>
              {serialGlyph} {serialLabel}
              {lastHardwareReadingAt && (
                <small> （上次读数 {new Date(lastHardwareReadingAt).toLocaleTimeString()}）</small>
              )}
            </td>
          </tr>
          <tr>
            <td>传感器来源</td>
            <td>
              {usesFallback
                ? sensorMode === "arduino"
                  ? "⏳ 已选 Arduino，等待实时读数"
                  : "🎚️ 手动滑块"
                : "🔌 Arduino 实时"}
            </td>
          </tr>
          <tr>
            <td>摄像头</td>
            <td>
              {camGlyph} {camLabel}
            </td>
          </tr>
          <tr>
            <td>上次 API 调用</td>
            <td>
              {apiGlyph}{" "}
              <small>{apiLabel}</small>
            </td>
          </tr>
          <tr>
            <td>网络</td>
            <td>{online ? "✅ 在线" : "❌ 离线"}</td>
          </tr>
          <tr>
            <td>串口状态</td>
            <td>
              <small>{statusMessage}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
