// Chinese display labels for status values that stay English internally.

import type { LiveCameraStatus } from "@/stores/plant/camera-store";
import type { RealtimeConnectionStatus } from "@/lib/plant/realtime-connection";

const CAMERA_STATUS_LABELS: Record<LiveCameraStatus, string> = {
  idle: "空闲",
  starting: "启动中",
  ready: "就绪",
  unsupported: "不支持",
  error: "出错",
};

const CONVERSATION_STATUS_LABELS: Record<RealtimeConnectionStatus, string> = {
  idle: "空闲",
  "requesting-mic": "请求麦克风",
  "minting-token": "获取令牌",
  connecting: "连接中",
  connected: "已连接",
  disconnected: "已断开",
  error: "出错",
};

const TREND_LABELS: Record<string, string> = {
  improving: "好转",
  stable: "稳定",
  declining: "变差",
  "insufficient-data": "数据不足",
};

export const cameraStatusLabel = (status: LiveCameraStatus) => CAMERA_STATUS_LABELS[status] ?? status;

export const conversationStatusLabel = (status: RealtimeConnectionStatus) =>
  CONVERSATION_STATUS_LABELS[status] ?? status;

export const trendLabel = (trend: string) => TREND_LABELS[trend] ?? trend;

export const lightLabel = (light: string) => (light === "on" ? "亮" : light === "off" ? "暗" : light);
