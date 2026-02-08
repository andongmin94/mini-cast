import { type OverlaySettings } from "@/components/settings/types";
import { type KeyPress } from "@/components/overlay/types";
import {
  formatKeyPressText,
  getPositionClasses,
  shouldRenderKeyPress,
} from "@/components/overlay/utils";

interface KeyDisplayLayerProps {
  settings: OverlaySettings;
  keyPresses: KeyPress[];
  displayId: number;
}

export default function KeyDisplayLayer({
  settings,
  keyPresses,
  displayId,
}: KeyDisplayLayerProps) {
  if (!settings.showKeyDisplay || displayId !== settings.keyDisplayMonitor) {
    return null;
  }

  return (
    <div
      className={`fixed ${getPositionClasses(settings.keyDisplayPosition)} flex flex-col`}
    >
      {keyPresses
        .filter(shouldRenderKeyPress)
        .map((keyPress) => (
          <div
            key={keyPress.timestamp}
            className="mb-2 rounded px-3 py-1"
            style={{
              backgroundColor: settings.keyDisplayBackgroundColor,
              color: settings.keyDisplayTextColor,
              fontSize: `${settings.keyDisplayFontSize}px`,
              animation: `${settings.keyDisplayDuration}ms ease-in-out`,
              textAlign: settings.keyDisplayPosition.includes("left")
                ? "left"
                : "right",
            }}
          >
            {formatKeyPressText(keyPress)}
          </div>
        ))}
    </div>
  );
}
