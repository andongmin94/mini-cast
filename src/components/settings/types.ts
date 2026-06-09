import { type KeyDisplayPosition } from "@/electron/contract";

export {
  type KeyDisplayPosition,
  type OverlaySettings,
} from "@/electron/contract";

export interface Display {
  id: number;
  name: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ControllerSettings {
  cursorFillColor: string;
  cursorFillOpacity: number;
  cursorStrokeColor: string;
  cursorStrokeOpacity: number;
  cursorSize: number;
  cursorStrokeSize: number;
  showCursorHighlight: boolean;
  keyDisplayMonitor: number;
  keyDisplayDuration: number;
  keyDisplayFontSize: number;
  keyDisplayBackgroundColor: string;
  keyDisplayBackgroundOpacity: number;
  keyDisplayTextColor: string;
  keyDisplayPosition: KeyDisplayPosition;
  showKeyDisplay: boolean;
}
