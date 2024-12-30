import React, { useState, useEffect, useCallback } from 'react';

interface ClickSpot {
  id: number;
  x: number;
  y: number;
}

interface Settings {
  cursorColor: string;
  cursorSize: number;
  showCursorHighlight: boolean;
  showClickHighlight: boolean;
  clickColor: string;
  clickSize: number;
  clickDuration: number;
}

const ClickHighlight: React.FC<{spot: ClickSpot; color: string; size: number}> = ({spot, color, size}) => (
  <div
    className="animate-clickspot pointer-events-none absolute rounded-full"
    style={{
      left: spot.x - size / 2,
      top: spot.y - size / 2,
      width: `${size}px`,
      height: `${size}px`,
      backgroundColor: color,
    }}
  />
);

export const Overlay: React.FC = () => {
  const [settings, setSettings] = useState<Settings>({
    cursorColor: "#FF0000",
    cursorSize: 24,
    showCursorHighlight: true,
    showClickHighlight: true,
    clickColor: "#00FF00",
    clickSize: 20,
    clickDuration: 1000,
  });
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [clickSpots, setClickSpots] = useState<ClickSpot[]>([]);

  const handleSettingsUpdate = useCallback((newSettings: Settings) => {
    console.log('New settings received:', newSettings);
    setSettings(newSettings);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setMousePosition({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseClick = useCallback((e: React.MouseEvent) => {
    console.log('Mouse clicked:', { x: e.clientX, y: e.clientY });
    if (!settings.showClickHighlight) return;
    const newSpot: ClickSpot = {
      id: Date.now(),
      x: e.clientX,
      y: e.clientY,
    };
    setClickSpots(prev => [...prev, newSpot]);
    setTimeout(() => {
      setClickSpots(prev => prev.filter(spot => spot.id !== newSpot.id));
    }, settings.clickDuration);
  }, [settings]);

  useEffect(() => {
    electron.on('update-settings', handleSettingsUpdate);
    return () => {
      electron.removeListener('update-settings', handleSettingsUpdate);
    };
  }, [handleSettingsUpdate]);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes clickspot {
        0% {
          transform: scale(0.5);
          opacity: 1;
        }
        100% {
          transform: scale(1.5);
          opacity: 0;
        }
      }
      .animate-clickspot {
        animation: clickspot ${settings.clickDuration}ms ease-out forwards;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, [settings.clickDuration]);

  return (
    <div 
      className="fixed inset-0 pointer-events-auto"
      style={{ 
        zIndex: 9999,
      }}
      onMouseMove={handleMouseMove}
      onClick={handleMouseClick}
    >
      {settings.showCursorHighlight && (
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            left: mousePosition.x,
            top: mousePosition.y,
            width: settings.cursorSize,
            height: settings.cursorSize,
            border: `2px solid ${settings.cursorColor}`,
            transform: "translate(-50%, -50%)",
            transition: "width 0.1s, height 0.1s",
          }}
          aria-hidden="true"
        />
      )}
      {clickSpots.map((spot) => (
        <ClickHighlight
          key={spot.id}
          spot={spot}
          color={settings.clickColor}
          size={settings.clickSize}
        />
      ))}
    </div>
  );
};