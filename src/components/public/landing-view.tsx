import { PLANT_NAME } from "@/lib/plant/realtime-config";

interface LandingViewProps {
  onStart: () => void;
  onHoverChange?: (hovered: boolean) => void;
}

export function LandingView({ onStart, onHoverChange }: LandingViewProps) {
  return (
    <div className="public-experience__center">
      <button
        type="button"
        className="public-experience__headline-link"
        onClick={onStart}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
        onFocus={() => onHoverChange?.(true)}
        onBlur={() => onHoverChange?.(false)}
      >
        <span className="public-experience__headline">和{PLANT_NAME}聊天</span>
      </button>
    </div>
  );
}
