import { type OverlaySettings } from "@/components/settings/types";
import {
  type MouseButtons,
  type MousePosition,
} from "@/components/overlay/types";

interface CursorLayerProps {
  settings: OverlaySettings;
  mousePosition: MousePosition | null;
  mouseButtons: MouseButtons;
}

export default function CursorLayer({
  settings,
  mousePosition,
  mouseButtons,
}: CursorLayerProps) {
  if (!mousePosition || !settings.showCursorHighlight) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute rounded-full"
      style={{
        left: mousePosition.x,
        top: mousePosition.y,
        width: settings.cursorSize,
        height: settings.cursorSize,
        backgroundColor: settings.cursorFillColor,
        border:
          mouseButtons.left || mouseButtons.middle || mouseButtons.right
            ? `${Math.min(settings.cursorStrokeSize, settings.cursorSize / 2)}px solid ${settings.cursorStrokeColor}`
            : "none",
        transform: "translate(-50%, -50%)",
        transition: "width 0.1s, height 0.1s",
      }}
      aria-hidden="true"
    />
  );
}
