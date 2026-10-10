import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@picocss/pico/css/pico.min.css";
import "./styles.css";
import { App } from "./app";
import { PLANT_NAME } from "@/lib/plant/realtime-config";
import { useAiConfigStore } from "@/stores/plant/ai-config-store";

// The static index.html can't read the constant — set the title here.
document.title = `和${PLANT_NAME}聊天`;

// Learn early whether voice runs on local models or OpenAI Realtime, so the
// first "Talk to" click already uses the right pipeline.
void useAiConfigStore.getState().load();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
