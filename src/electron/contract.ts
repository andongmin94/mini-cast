export type KeyDisplayPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  name: string;
  bounds: Bounds;
}

export interface OverlaySettings {
  cursorFillColor: string;
  cursorStrokeColor: string;
  cursorSize: number;
  cursorStrokeSize: number;
  showCursorHighlight: boolean;
  keyDisplayMonitor: number;
  keyDisplayDuration: number;
  keyDisplayFontSize: number;
  keyDisplayBackgroundColor: string;
  keyDisplayTextColor: string;
  keyDisplayPosition: KeyDisplayPosition;
  showKeyDisplay: boolean;
}

export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  timestamp: number;
  displayId: number;
}

export interface MousePosition {
  x: number;
  y: number;
}

export type MouseButton = "left" | "middle" | "right";

export interface MouseButtonEvent {
  button: MouseButton;
  pressed: boolean;
}

export interface OverlayInit {
  id: number;
  width: number;
  height: number;
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  cursorFillColor: "rgba(0, 100, 255, 0.5)",
  cursorStrokeColor: "rgba(32, 38, 50, 0.5)",
  cursorSize: 30,
  cursorStrokeSize: 3,
  showCursorHighlight: true,
  keyDisplayMonitor: 0,
  keyDisplayDuration: 2000,
  keyDisplayFontSize: 16,
  keyDisplayBackgroundColor: "rgba(0, 0, 0, 0.5)",
  keyDisplayTextColor: "#FFFFFF",
  keyDisplayPosition: "bottom-right",
  showKeyDisplay: true,
};
