import React, { useState, useEffect, useCallback } from 'react';

interface Settings {
  cursorFillColor: string;
  cursorStrokeColor: string;
  cursorSize: number;
  showCursorHighlight: boolean;
}

export const Overlay: React.FC = () => {
  const [settings, setSettings] = useState<Settings>({
    cursorFillColor: "rgba(0, 0, 0, 0.5)",
    cursorStrokeColor: "rgba(0, 0, 0, 0.5)",
    cursorSize: 30,
    showCursorHighlight: true,
  });
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);

  const handleSettingsUpdate = useCallback((newSettings: Settings) => {
    console.log('New settings received:', newSettings);
    setSettings(newSettings);
  }, []);

  const handleMouseMove = useCallback((position: { x: number; y: number } | null) => {
    setMousePosition(position);
  }, []);

  useEffect(() => {
    electron.on('update-settings', handleSettingsUpdate);
    electron.on('mouse-move', handleMouseMove);
    return () => {
      electron.removeListener('update-settings', handleSettingsUpdate);
      electron.removeListener('mouse-move', handleMouseMove);
    };
  }, [handleSettingsUpdate, handleMouseMove]);

  if (!mousePosition || !settings.showCursorHighlight) {
    return null;
  }

  return (
    <div 
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 9999 }}
    >
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
    </div>
  );
};