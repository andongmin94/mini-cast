import React, { useState, useEffect, useCallback, useRef } from 'react';

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

export const Overlay: React.FC = () => {
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
  });
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
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
    console.log('New settings received:', newSettings);
    setSettings(newSettings);
  }, []);

  const handleMouseMove = useCallback((position: { x: number; y: number } | null) => {
    setMousePosition(position);
  }, []);

  const handleKeyPress = useCallback((keyPress: KeyPress) => {
    if (keyPress.displayId === settingsRef.current.keyDisplayMonitor) {
      setKeyPresses(prev => {
        const newKeyPresses = [...prev, keyPress];
        setTimeout(() => {
          setKeyPresses(current => current.filter(kp => kp.timestamp !== keyPress.timestamp));
        }, settingsRef.current.keyDisplayDuration);
        return newKeyPresses;
      });
    }
  }, []);

  const handleInit = useCallback((data: { id: number }) => {
    setDisplayId(data.id);
  }, []);

  useEffect(() => {
    const settingsListener = (newSettings: Settings) => handleSettingsUpdate(newSettings);
    const mouseMoveListener = (position: { x: number; y: number } | null) => handleMouseMove(position);
    const keyPressListener = (keyPress: KeyPress) => handleKeyPress(keyPress);
    const initListener = (data: { id: number }) => handleInit(data);

    electron.on('update-settings', settingsListener);
    electron.on('mouse-move', mouseMoveListener);
    electron.on('key-press', keyPressListener);
    electron.on('init', initListener);

    return () => {
      electron.removeListener('update-settings', settingsListener);
      electron.removeListener('mouse-move', mouseMoveListener);
      electron.removeListener('key-press', keyPressListener);
      electron.removeListener('init', initListener);
    };
  }, []);

  return (
    <div 
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 9999 }}
    >
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
      {displayId === settings.keyDisplayMonitor && (
        <div className="fixed bottom-4 right-4 flex flex-col items-end">
          {keyPresses.map((keyPress) => (
            <div
              key={keyPress.timestamp}
              className="mb-2 px-3 py-1 rounded"
              style={{
                backgroundColor: settings.keyDisplayBackgroundColor,
                color: settings.keyDisplayTextColor,
                fontSize: `${settings.keyDisplayFontSize}px`,
                animation: `fadeInOut ${settings.keyDisplayDuration}ms ease-in-out`,
              }}
            >
              {[
                keyPress.ctrlKey && 'Ctrl',
                keyPress.shiftKey && 'Shift',
                keyPress.altKey && 'Alt',
                keyPress.metaKey && 'Meta',
                keyPress.key !== 'Control' && keyPress.key !== 'Shift' && keyPress.key !== 'Alt' && keyPress.key !== 'Meta' && keyPress.key
              ].filter(Boolean).join(' + ')}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// CSS animation for fade in and out effect
const style = document.createElement('style');
style.textContent = `
  @keyframes fadeInOut {
    0% { opacity: 0; transform: translateY(20px); }
    10% { opacity: 1; transform: translateY(0); }
    90% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(-20px); }
  }
`;
document.head.appendChild(style);