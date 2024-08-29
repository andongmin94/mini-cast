import { useCallback, useEffect, useRef, useState } from "react";

interface Settings {
  cursorFillColor: string;
  cursorStrokeColor: string;
  cursorSize: number;
  showCursorHighlight: boolean;
  keyDisplayMonitor: number;
  keyDisplayDuration: number;
  keyDisplayFontSize: number;
  keyDisplayBackgroundColor: string;
  keyDisplayTextColor: string;
  keyDisplayPosition: string;
  showKeyDisplay: boolean; // 추가된 설정
}

interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  timestamp: number;
  displayId: number;
}

export default function Overlay() {
  const [settings, setSettings] = useState<Settings>({
    cursorFillColor: "rgba(255, 255, 0, 0.5)",
    cursorStrokeColor: "rgba(255, 0, 0, 0.5)",
    cursorSize: 30,
    showCursorHighlight: true,
    keyDisplayMonitor: 0,
    keyDisplayDuration: 2000,
    keyDisplayFontSize: 16,
    keyDisplayBackgroundColor: "rgba(0, 0, 0, 0.7)",
    keyDisplayTextColor: "rgba(255, 255, 255, 1)",
    keyDisplayPosition: "bottom-right",
    showKeyDisplay: true, // 기본값 설정
  });
  const [mousePosition, setMousePosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [keyPresses, setKeyPresses] = useState<KeyPress[]>([]);
  const [displayId, setDisplayId] = useState<number>(0);

  const settingsRef = useRef(settings);
  const displayIdRef = useRef(displayId);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    displayIdRef.current = displayId;
  }, [displayId]);

  const handleSettingsUpdate = useCallback((newSettings: Settings) => {
    console.log("New settings received:", newSettings);
    setSettings(newSettings);
  }, []);

  const handleMouseMove = useCallback(
    (position: { x: number; y: number } | null) => {
      setMousePosition(position);
    },
    [],
  );

  const handleKeyPress = useCallback((keyPress: KeyPress) => {
    if (
      settingsRef.current.showKeyDisplay &&
      keyPress.displayId === settingsRef.current.keyDisplayMonitor
    ) {
      setKeyPresses((prev) => {
        const newKeyPresses = [...prev, keyPress];
        setTimeout(() => {
          setKeyPresses((current) =>
            current.filter((kp) => kp.timestamp !== keyPress.timestamp),
          );
        }, settingsRef.current.keyDisplayDuration);
        return newKeyPresses;
      });
    }
  }, []);

  const handleInit = useCallback((data: { id: number }) => {
    setDisplayId(data.id);
  }, []);

  useEffect(() => {
    const settingsListener = (newSettings: Settings) =>
      handleSettingsUpdate(newSettings);
    const mouseMoveListener = (position: { x: number; y: number } | null) =>
      handleMouseMove(position);
    const keyPressListener = (keyPress: KeyPress) => handleKeyPress(keyPress);
    const initListener = (data: { id: number }) => handleInit(data);

    electron.on("update-settings", settingsListener);
    electron.on("mouse-move", mouseMoveListener);
    electron.on("key-press", keyPressListener);
    electron.on("init", initListener);

    return () => {
      electron.removeListener("update-settings", settingsListener);
      electron.removeListener("mouse-move", mouseMoveListener);
      electron.removeListener("key-press", keyPressListener);
      electron.removeListener("init", initListener);
    };
  }, []);

  const getPositionClasses = (position: string) => {
    switch (position) {
      case "top-left":
        return "top-4 left-4 items-start";
      case "top-right":
        return "top-4 right-4 items-end";
      case "bottom-left":
        return "bottom-4 left-4 items-start";
      case "bottom-right":
        return "bottom-4 right-4 items-end";
      default:
        return "bottom-4 right-4 items-end";
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: 9999 }}>
      {mousePosition && settings.showCursorHighlight && (
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            left: mousePosition.x,
            top: mousePosition.y,
            width: settings.cursorSize,
            height: settings.cursorSize,
            backgroundColor: settings.cursorFillColor,
            border: `2px solid ${settings.cursorStrokeColor}`,
            transform: "translate(-50%, -50%)",
            transition: "width 0.1s, height 0.1s",
          }}
          aria-hidden="true"
        />
      )}
      {settings.showKeyDisplay && displayId === settings.keyDisplayMonitor && (
        <div
          className={`fixed ${getPositionClasses(settings.keyDisplayPosition)} flex flex-col`}
        >
          {keyPresses.map((keyPress) => (
            <div
              key={keyPress.timestamp}
              className="mb-2 rounded px-3 py-1"
              style={{
                backgroundColor: settings.keyDisplayBackgroundColor,
                color: settings.keyDisplayTextColor,
                fontSize: `${settings.keyDisplayFontSize}px`,
                animation: `fadeInOut ${settings.keyDisplayDuration}ms ease-in-out`,
                textAlign: settings.keyDisplayPosition.includes("left")
                  ? "left"
                  : "right",
              }}
            >
              {[
                keyPress.ctrlKey && "Ctrl",
                keyPress.shiftKey && "Shift",
                keyPress.altKey && "Alt",
                keyPress.metaKey && "Meta",
                keyPress.key === "Mouse left"
                  ? "좌클릭"
                  : keyPress.key === "Mouse right"
                    ? "우클릭"
                    : keyPress.key === "Mouse middle"
                      ? "휠"
                      : keyPress.key !== "Control" &&
                        keyPress.key !== "Shift" &&
                        keyPress.key !== "Alt" &&
                        keyPress.key !== "Meta" &&
                        keyPress.key,
              ]
                .filter(Boolean)
                .join(" + ")}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// CSS animation for fade in and out effect
const style = document.createElement("style");
style.textContent = `
  @keyframes fadeInOut {
    0% { opacity: 0; transform: translateY(20px); }
    10% { opacity: 1; transform: translateY(0); }
    90% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-20px); }
  }
`;
document.head.appendChild(style);
