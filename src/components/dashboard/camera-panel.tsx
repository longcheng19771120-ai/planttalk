import { useEffect, useRef } from "react";
import { usePlantCameraStore } from "@/stores/plant/camera-store";
import { cameraStatusLabel } from "@/lib/plant/labels";
import { actionGlyph, type ActionStatus } from "@/components/dashboard/action-glyph";

export function CameraPanel() {
  const cameraStream = usePlantCameraStore((s) => s.cameraStream);
  const cameraStatus = usePlantCameraStore((s) => s.cameraStatus);
  const cameraError = usePlantCameraStore((s) => s.cameraError);
  const availableCameras = usePlantCameraStore((s) => s.availableCameras);
  const selectedCameraId = usePlantCameraStore((s) => s.selectedCameraId);
  const startCamera = usePlantCameraStore((s) => s.startCamera);
  const stopCamera = usePlantCameraStore((s) => s.stopCamera);
  const refreshCameraList = usePlantCameraStore((s) => s.refreshCameraList);
  const selectCamera = usePlantCameraStore((s) => s.selectCamera);

  const videoRef = useRef<HTMLVideoElement>(null);

  // srcObject can't be set via JSX — bind the stream imperatively.
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream]);

  // Populate the camera dropdown, and keep it current when devices are
  // plugged in or removed. (Labels stay generic until camera permission is
  // granted — they fill in after the first successful start.)
  useEffect(() => {
    void refreshCameraList();

    if (!("mediaDevices" in navigator) || !navigator.mediaDevices.addEventListener) return;
    const onDeviceChange = () => void refreshCameraList();
    navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
  }, [refreshCameraList]);

  // The selected camera may have been unplugged since last session.
  const selectionMissing =
    selectedCameraId !== null &&
    availableCameras.length > 0 &&
    !availableCameras.some((camera) => camera.deviceId === selectedCameraId);

  const status: ActionStatus =
    cameraStatus === "ready"
      ? "done"
      : cameraStatus === "starting"
        ? "working"
        : cameraStatus === "error"
          ? "error"
          : cameraStatus === "unsupported"
            ? "warn"
            : "todo";

  return (
    <article>
      <header>
        {actionGlyph(status)} <strong>摄像头</strong> <small>（{cameraStatusLabel(cameraStatus)}）</small>
      </header>

      {availableCameras.length > 0 && (
        <label>
          摄像头设备
          <select
            value={selectedCameraId ?? ""}
            disabled={cameraStatus === "starting"}
            onChange={(event) => selectCamera(event.target.value || null)}
          >
            <option value="">浏览器默认</option>
            {availableCameras.map((camera) => (
              <option key={camera.deviceId} value={camera.deviceId}>
                {camera.label}
              </option>
            ))}
          </select>
          {selectionMissing && <small>之前选择的摄像头未连接。</small>}
        </label>
      )}

      {cameraStream ? (
        <video ref={videoRef} autoPlay muted playsInline />
      ) : (
        <p>
          <small>
            摄像头为观察循环供图——每轮发送给模型的植物照片都来自这里。
          </small>
        </p>
      )}

      {cameraError && (
        <p>
          <mark>{cameraError}</mark>
        </p>
      )}

      <footer>
        <button
          type="button"
          className={cameraStatus === "ready" ? "secondary" : undefined}
          disabled={cameraStatus === "starting" || cameraStatus === "unsupported"}
          aria-busy={cameraStatus === "starting"}
          onClick={cameraStatus === "ready" ? stopCamera : () => void startCamera()}
        >
          {cameraStatus === "ready" ? "关闭摄像头" : "打开摄像头"}
        </button>
      </footer>
    </article>
  );
}
