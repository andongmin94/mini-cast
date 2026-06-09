import { type KeyPress, type MousePosition } from "@/electron/contract";

import { type OverlaySettings } from "@/components/settings/types";

export { type KeyPress, type MousePosition } from "@/electron/contract";

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
