import { useEffect, useRef, useState } from "react";

import type {
  KeyDisplayPosition,
  KeyPress,
  MouseButtonEvent,
  MousePosition,
  OverlayInit,
  OverlaySettings,
} from "@/electron/contract";
import { DEFAULT_OVERLAY_SETTINGS } from "@/electron/contract";

interface MouseButtons {
  left: boolean;
  middle: boolean;
  right: boolean;
}

const POSITION_CLASSES: Record<KeyDisplayPosition, string> = {
  "top-left": "top-4 left-4 items-start",
  "top-right": "top-4 right-4 items-end",
  "bottom-left": "bottom-4 left-4 items-start",
  "bottom-right": "right-4 bottom-4 items-end",
};

function formatKeyPress(keyPress: KeyPress) {
  return [
    keyPress.ctrlKey && "Ctrl",
    keyPress.shiftKey && "Shift",
    keyPress.altKey && "Alt",
    keyPress.metaKey && "Meta",
    keyPress.key,
  ]
    .filter(Boolean)
    .join(" + ");
}

export default function Overlay() {
  const [settings, setSettings] = useState<OverlaySettings>(
    DEFAULT_OVERLAY_SETTINGS,
  );
  const [mousePosition, setMousePosition] = useState<MousePosition | null>(null);
  const [mouseButtons, setMouseButtons] = useState<MouseButtons>({
    left: false,
    middle: false,
    right: false,
  });
  const [keyPresses, setKeyPresses] = useState<KeyPress[]>([]);
  const [displayId, setDisplayId] = useState(0);

  const settingsRef = useRef(settings);
  const sourceSize = useRef({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (typeof miniCast === "undefined") return;

    const scalePosition = (position: MousePosition) => ({
      x: Math.round(
        position.x * (window.innerWidth / Math.max(sourceSize.current.width, 1)),
      ),
      y: Math.round(
        position.y *
          (window.innerHeight / Math.max(sourceSize.current.height, 1)),
      ),
    });

    const onKeyPress = (keyPress: KeyPress) => {
      const current = settingsRef.current;
      if (
        !current.showKeyDisplay ||
        keyPress.displayId !== current.keyDisplayMonitor
      ) {
        return;
      }

      setKeyPresses((items) => [...items, keyPress]);
      window.setTimeout(() => {
        setKeyPresses((items) => items.filter((item) => item !== keyPress));
      }, current.keyDisplayDuration);
    };

    const onMouseButton = ({ button, pressed }: MouseButtonEvent) => {
      setMouseButtons((current) => ({ ...current, [button]: pressed }));
    };

    const onOverlayInit = ({ id, width, height }: OverlayInit) => {
      setDisplayId(id);
      sourceSize.current = { width, height };
    };

    const unsubscribe = [
      miniCast.onSettingsUpdated(setSettings),
      miniCast.onMouseMove((position) =>
        setMousePosition(position ? scalePosition(position) : null),
      ),
      miniCast.onMouseButton(onMouseButton),
      miniCast.onKeyPress(onKeyPress),
      miniCast.onOverlayInit(onOverlayInit),
    ];

    miniCast.notifyOverlayReady();
    return () => unsubscribe.forEach((stop) => stop());
  }, []);

  const cursorPressed =
    mouseButtons.left || mouseButtons.middle || mouseButtons.right;
  const cursorRadius = settings.cursorSize / 2;

  return (
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: 9999 }}>
      {mousePosition && settings.showCursorHighlight && (
        <div
          className="absolute rounded-full"
          style={{
            width: settings.cursorSize,
            height: settings.cursorSize,
            backgroundColor: settings.cursorFillColor,
            border: cursorPressed
              ? `${Math.min(settings.cursorStrokeSize, cursorRadius)}px solid ${settings.cursorStrokeColor}`
              : "none",
            transform: `translate3d(${mousePosition.x - cursorRadius}px, ${mousePosition.y - cursorRadius}px, 0)`,
            willChange: "transform",
          }}
        />
      )}

      {settings.showKeyDisplay && displayId === settings.keyDisplayMonitor && (
        <div
          className={`fixed flex flex-col ${POSITION_CLASSES[settings.keyDisplayPosition]}`}
        >
          {keyPresses.map((keyPress, index) => (
            <div
              key={`${keyPress.timestamp}-${index}`}
              className="mb-2 rounded px-3 py-1"
              style={{
                backgroundColor: settings.keyDisplayBackgroundColor,
                color: settings.keyDisplayTextColor,
                fontSize: settings.keyDisplayFontSize,
                textAlign: settings.keyDisplayPosition.includes("left")
                  ? "left"
                  : "right",
              }}
            >
              {formatKeyPress(keyPress)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
