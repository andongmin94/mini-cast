import { screen, type Display } from "electron";

import { orderDisplays } from "./display-order.js";

export interface OverlayDisplayMeta {
  id: number;
  bounds: Display["workArea"];
}

export function getOrderedDisplays(): Display[] {
  return orderDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
}

export function getConnectedDisplays() {
  return getOrderedDisplays().map((display, index) => ({
    id: display.id,
    name: `모니터 ${index + 1}`,
    bounds: { ...display.workArea },
  }));
}

export function toOverlayDisplayMeta(display: Display): OverlayDisplayMeta {
  return { id: display.id, bounds: { ...display.workArea } };
}

export function getOrderedOverlayDisplays() {
  return getOrderedDisplays().map(toOverlayDisplayMeta);
}
