import { DEFAULT_OVERLAY_SETTINGS } from "@/electron/contract";

import { type ControllerSettings } from "./types";

export { DEFAULT_OVERLAY_SETTINGS };

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
