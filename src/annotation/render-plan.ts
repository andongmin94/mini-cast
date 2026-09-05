import type { AnnotationStroke } from "./history.js";

export interface CommittedRenderState {
  displayId: number | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  canvasWidth: number;
  canvasHeight: number;
  pixelRatio: number;
  strokes: readonly AnnotationStroke[];
}

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CommittedRenderPlan {
  readonly kind: "full" | "append" | "dirty" | "none";
  /** Device-pixel rectangle. Clipping to fractional device pixels creates alpha seams. */
  readonly clear: PixelRect | null;
  readonly strokes: readonly AnnotationStroke[];
}

interface InkBounds { minX: number; minY: number; maxX: number; maxY: number }
const inkBoundsCache = new WeakMap<AnnotationStroke, InkBounds>();

function pixelInkBounds(stroke: AnnotationStroke, ratio: number): PixelRect {
  let bounds = inkBoundsCache.get(stroke);
  if (!bounds) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
    const radius = stroke.width / 2;
    bounds = { minX: minX - radius, minY: minY - radius, maxX: maxX + radius, maxY: maxY + radius };
    inkBoundsCache.set(stroke, bounds);
  }
  // Two extra device pixels cover antialiasing, round caps and rounding error.
  const x = Math.floor(bounds.minX * ratio) - 2;
  const y = Math.floor(bounds.minY * ratio) - 2;
  return { x, y, width: Math.ceil(bounds.maxX * ratio) + 2 - x,
    height: Math.ceil(bounds.maxY * ratio) + 2 - y };
}

function sameSurface(previous: CommittedRenderState, next: CommittedRenderState) {
  return previous.displayId === next.displayId &&
    previous.viewportWidth === next.viewportWidth && previous.viewportHeight === next.viewportHeight &&
    previous.canvasWidth === next.canvasWidth && previous.canvasHeight === next.canvasHeight &&
    previous.pixelRatio === next.pixelRatio;
}

function rectsOverlap(a: PixelRect, b: PixelRect) {
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
}

/** The inputs retain immutable stroke references, not just IDs that can hide geometry changes. */
export function planCommittedRender(
  previous: CommittedRenderState | null,
  next: CommittedRenderState,
): CommittedRenderPlan {
  if (!previous || !sameSurface(previous, next)) return {
    kind: "full", clear: { x: 0, y: 0, width: next.canvasWidth, height: next.canvasHeight },
    strokes: next.strokes,
  };
  let prefix = 0;
  while (prefix < previous.strokes.length && prefix < next.strokes.length &&
      previous.strokes[prefix] === next.strokes[prefix]) prefix += 1;
  if (prefix === previous.strokes.length) return {
    kind: prefix === next.strokes.length ? "none" : "append", clear: null,
    strokes: next.strokes.slice(prefix),
  };

  const before = new Map(previous.strokes.map(stroke => [stroke.id, stroke]));
  const after = new Map(next.strokes.map(stroke => [stroke.id, stroke]));
  const changed = [
    ...previous.strokes.filter(stroke => after.get(stroke.id) !== stroke),
    ...next.strokes.filter(stroke => before.get(stroke.id) !== stroke),
  ];
  // A changed relative stacking order affects alpha even when no ID or point changes.
  const retained = previous.strokes.filter(stroke => after.get(stroke.id) === stroke);
  let retainedIndex = 0;
  for (const stroke of next.strokes) {
    if (before.get(stroke.id) === stroke && retained[retainedIndex++] !== stroke) {
      changed.push(...previous.strokes, ...next.strokes);
      break;
    }
  }
  let left = next.canvasWidth, top = next.canvasHeight, right = 0, bottom = 0;
  for (const stroke of changed) {
    const bounds = pixelInkBounds(stroke, next.pixelRatio);
    left = Math.min(left, bounds.x); top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width); bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  left = Math.max(0, left); top = Math.max(0, top);
  right = Math.min(next.canvasWidth, right); bottom = Math.min(next.canvasHeight, bottom);
  if (left >= right || top >= bottom) return { kind: "none", clear: null, strokes: [] };
  const clear = { x: left, y: top, width: right - left, height: bottom - top };
  // Include unchanged intersecting strokes in original z-order, and draw each only once.
  return { kind: "dirty", clear, strokes: next.strokes.filter(stroke =>
    rectsOverlap(pixelInkBounds(stroke, next.pixelRatio), clear)) };
}
