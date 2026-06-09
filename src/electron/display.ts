import { screen, type Display } from "electron";

export interface OverlayDisplayMeta {
  id: number;
  bounds: Display["bounds"];
}

export function getOrderedDisplays(): Display[] {
  const primaryDisplay = screen.getPrimaryDisplay();

  return [...screen.getAllDisplays()].sort((left, right) => {
    const leftIsPrimary = left.id === primaryDisplay.id;
    const rightIsPrimary = right.id === primaryDisplay.id;

    if (leftIsPrimary !== rightIsPrimary) {
      return leftIsPrimary ? -1 : 1;
    }

    return (
      left.bounds.y - right.bounds.y ||
      left.bounds.x - right.bounds.x ||
      left.id - right.id
    );
  });
}

export function getConnectedDisplays() {
  return getOrderedDisplays().map((display, index) => ({
    id: display.id,
    name: `모니터 ${index + 1}`,
    bounds: display.bounds,
  }));
}

export function toOverlayDisplayMeta(display: Display): OverlayDisplayMeta {
  return {
    id: display.id,
    bounds: { ...display.bounds },
  };
}
