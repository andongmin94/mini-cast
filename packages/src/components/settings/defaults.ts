import { type ControllerSettings, type OverlaySettings } from "./types";

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

export const DEFAULT_CONTROLLER_SETTINGS: ControllerSettings = {
  cursorFillColor: "#0064FF",
  cursorFillOpacity: 0.5,
  cursorStrokeColor: "#202632",
  cursorStrokeOpacity: 0.5,
  cursorSize: 30,
  cursorStrokeSize: 3,
  showCursorHighlight: true,
  keyDisplayMonitor: 0,
  keyDisplayDuration: 2000,
  keyDisplayFontSize: 16,
  keyDisplayBackgroundColor: "#000000",
  keyDisplayBackgroundOpacity: 0.5,
  keyDisplayTextColor: "#FFFFFF",
  keyDisplayPosition: "bottom-right",
  showKeyDisplay: true,
};
