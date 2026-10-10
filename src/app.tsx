import { PlantDashboard } from "@/components/dashboard/plant-dashboard";
import { AmbientExperience } from "@/components/public/public-experience";
import { useUiModeStore } from "@/stores/plant/ui-mode-store";
import { PLANT_NAME } from "@/lib/plant/realtime-config";

// Single-page app, no router needed. Ambient mode sits on top of the dashboard
// so the camera, sensors, observation loop, and conversation state keep running.
export function App() {
  const mode = useUiModeStore((state) => state.mode);
  const setMode = useUiModeStore((state) => state.setMode);

  return (
    <>
      <header className="container">
        <h1>和{PLANT_NAME}聊天 🪴</h1>
        <p>
          一盆有传感器、摄像头、记忆和主见的盆栽——由本地模型或 OpenAI API 驱动。这个面板展示系统正在做的一切。
        </p>
        <button type="button" className="secondary outline" onClick={() => setMode("ambient")}>
          打开沉浸模式
        </button>
      </header>
      <main>
        <PlantDashboard />
      </main>
      {mode === "ambient" && <AmbientExperience onExit={() => setMode("dashboard")} />}
    </>
  );
}
