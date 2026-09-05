import { AnnotationError } from "./errors.js";
import type { AnnotationPoint } from "./history.js";
import type { InkBounds } from "./shape-geometry.js";

export const FULL_TURN = 2 * Math.PI;
export const ROTATION_SNAP = Math.PI / 12;
export const ROTATION_HANDLE_SIZE = 20;

export function normalizeRotation(radians: number): number {
  if (!Number.isFinite(radians) || Math.abs(radians) > FULL_TURN + 1e-12)
    throw new AnnotationError("invalid-element");
  let value = radians % FULL_TURN;
  if (value > Math.PI) value -= FULL_TURN;
  if (value < -Math.PI) value += FULL_TURN;
  return Math.abs(value) < 1e-12 ? 0 : value;
}

export function selectionRotationCenter(bounds: InkBounds): AnnotationPoint {
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) ||
      bounds.maxX < bounds.minX || bounds.maxY < bounds.minY)
    throw new AnnotationError("invalid-element");
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

/** Positive angles rotate clockwise in screen coordinates. Canonical quarter turns
 * use exact coefficients, so repeated 90-degree operations do not accumulate drift. */
export function rotatePoint(point: AnnotationPoint, center: AnnotationPoint, radians: number): AnnotationPoint {
  const angle = normalizeRotation(radians);
  if (![point.x, point.y, center.x, center.y].every(Number.isFinite))
    throw new AnnotationError("invalid-element");
  if (angle === 0) return { ...point };
  const quarter = Math.round(angle / (Math.PI / 2));
  const exact = Math.abs(angle - quarter * Math.PI / 2) < 1e-12;
  const cos = exact ? [1, 0, -1, 0][(quarter % 4 + 4) % 4] : Math.cos(angle);
  const sin = exact ? [0, 1, 0, -1][(quarter % 4 + 4) % 4] : Math.sin(angle);
  const x = point.x - center.x, y = point.y - center.y;
  return { x: center.x + cos * x - sin * y, y: center.y + sin * x + cos * y };
}

/** Start at the actual pointer-down position, not the visual handle's center.
 * Inside a small pivot dead zone no angle is defined: keep the last preview. */
export function selectionRotationAngle(center: AnnotationPoint, start: AnnotationPoint,
  point: AnnotationPoint, snap: boolean): number | null {
  if (typeof snap !== "boolean" || ![center.x, center.y, start.x, start.y, point.x, point.y].every(Number.isFinite))
    throw new AnnotationError("invalid-element");
  if (Math.hypot(start.x - center.x, start.y - center.y) < 2 ||
      Math.hypot(point.x - center.x, point.y - center.y) < 2) return null;
  const angle = normalizeRotation(Math.atan2(point.y - center.y, point.x - center.x) -
    Math.atan2(start.y - center.y, start.x - center.x));
  return normalizeRotation(snap ? Math.round(angle / ROTATION_SNAP) * ROTATION_SNAP : angle);
}

/** A separate rotation target must remain visible even at screen edges.
 * UI placement never changes the actual group pivot. */
export function rotationHandlePoint(bounds: InkBounds, viewport: { width: number; height: number }): AnnotationPoint {
  const center = selectionRotationCenter(bounds);
  if (![viewport.width, viewport.height].every(n => Number.isFinite(n) && n > 0))
    throw new AnnotationError("invalid-element");
  const margin = ROTATION_HANDLE_SIZE / 2;
  const gap = 30;
  const candidates = [
    { x: center.x, y: bounds.minY - gap },
    { x: bounds.maxX + gap, y: center.y },
    { x: bounds.minX - gap, y: center.y },
    { x: center.x, y: bounds.maxY + gap },
  ];
  const fits = (p: AnnotationPoint) => p.x >= margin && p.x <= viewport.width - margin &&
    p.y >= margin && p.y <= viewport.height - margin;
  const available = candidates.find(fits);
  if (available) return available;
  const clamp = (value: number, extent: number) => Math.max(Math.min(margin, extent / 2),
    Math.min(value, Math.max(extent - margin, extent / 2)));
  return { x: clamp(center.x, viewport.width), y: clamp(bounds.minY + gap, viewport.height) };
}
