import {
  type MouseButtons,
  type MousePosition,
} from "@/components/overlay/types";
import { type OverlaySettings } from "@/components/settings/types";

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
        left: 0,
        top: 0,
        width: settings.cursorSize,
        height: settings.cursorSize,
        backgroundColor: settings.cursorFillColor,
        border:
          mouseButtons.left || mouseButtons.middle || mouseButtons.right
            ? `${Math.min(settings.cursorStrokeSize, settings.cursorSize / 2)}px solid ${settings.cursorStrokeColor}`
            : "none",
        transform: `translate3d(${mousePosition.x - settings.cursorSize / 2}px, ${mousePosition.y - settings.cursorSize / 2}px, 0)`,
        transition: "width 0.06s, height 0.06s",
        willChange: "transform, width, height",
      }}
      aria-hidden="true"
    />
  );
}
