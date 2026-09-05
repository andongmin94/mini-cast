import { AnnotationError } from "./errors.js";
import type { AnnotationPoint } from "./history.js";
import type { InkBounds } from "./shape-geometry.js";

export const RESIZE_HANDLES = ["nw", "ne", "sw", "se"] as const;
export type ResizeHandle = (typeof RESIZE_HANDLES)[number];

export interface SelectionResizeTransform {
  readonly anchor: AnnotationPoint;
  readonly scaleX: number;
  readonly scaleY: number;
}

export function isResizeHandle(value: unknown): value is ResizeHandle {
  return typeof value === "string" && (RESIZE_HANDLES as readonly string[]).includes(value);
}

export function resizeHandlePoint(bounds: InkBounds, handle: ResizeHandle): AnnotationPoint {
  return {
    x: handle.endsWith("w") ? bounds.minX : bounds.maxX,
    y: handle.startsWith("n") ? bounds.minY : bounds.maxY,
  };
}

/** Keep the opposite corner fixed. Displacements are relative to pointer-down,
 * not the handle center, so clicking its edge never causes a geometry jump.
 * Crossing the opposite corner stops at a positive extent instead of mirroring.
 */
export function selectionResizeTransform(
  bounds: InkBounds,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  lockAspect: boolean,
): SelectionResizeTransform {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!isResizeHandle(handle) || typeof lockAspect !== "boolean" ||
      ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, dx, dy, width, height].every(Number.isFinite) ||
      width <= 0 || height <= 0) throw new AnnotationError("invalid-element");
  const west = handle.endsWith("w");
  const north = handle.startsWith("n");
  const anchor = {
    x: west ? bounds.maxX : bounds.minX,
    y: north ? bounds.maxY : bounds.minY,
  };
  // Already tiny dots must not grow merely because a handle was clicked.
  const minX = Math.min(1, 2 / width);
  const minY = Math.min(1, 2 / height);
  const requestedWidth = width + (west ? -dx : dx);
  const requestedHeight = height + (north ? -dy : dy);
  if (lockAspect) {
    // Project onto the original diagonal; avoid abrupt changes of the dominant axis.
    const scale = Math.max(minX, minY,
      (requestedWidth * width + requestedHeight * height) / (width * width + height * height));
    return { anchor, scaleX: scale, scaleY: scale };
  }
  return {
    anchor,
    scaleX: Math.max(minX, requestedWidth / width),
    scaleY: Math.max(minY, requestedHeight / height),
  };
}

export const RESIZE_HANDLE_SIZE = 12;

/** Keep four independent hit targets even for a dot or a screen-edge selection.
 * This is UI geometry only; the transformation pivot still uses the ink bounds. */
export function resizeHandleDisplayBounds(bounds: InkBounds, viewport: { width: number; height: number }): InkBounds {
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, viewport.width, viewport.height].every(Number.isFinite) ||
      bounds.maxX < bounds.minX || bounds.maxY < bounds.minY || viewport.width <= 0 || viewport.height <= 0)
    throw new AnnotationError("invalid-element");
  const fit = (min: number, max: number, extent: number) => {
    const low = Math.min(RESIZE_HANDLE_SIZE / 2, extent / 2);
    const high = Math.max(low, extent - RESIZE_HANDLE_SIZE / 2);
    const span = Math.min(max - min + 16, high - low);
    const start = Math.min(Math.max(min - 8, low), high - span);
    return { min: start, max: start + span };
  };
  const x = fit(bounds.minX, bounds.maxX, viewport.width);
  const y = fit(bounds.minY, bounds.maxY, viewport.height);
  return { minX: x.min, minY: y.min, maxX: x.max, maxY: y.max };
}
