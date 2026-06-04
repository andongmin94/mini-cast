import { type OverlaySettings } from "@/components/settings/types";

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

export interface MouseButtons {
  left: boolean;
  middle: boolean;
  right: boolean;
}

export interface OverlayViewModel {
  settings: OverlaySettings;
  mousePosition: MousePosition | null;
  keyPresses: KeyPress[];
  displayId: number;
  mouseButtons: MouseButtons;
}
