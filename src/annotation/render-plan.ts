import type { AnnotationElement } from "./history.js";
import { elementInkBounds } from "./shape-geometry.js";

export interface CommittedRenderState {
  displayId: number | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  canvasWidth: number;
  canvasHeight: number;
  pixelRatio: number;
  elements: readonly AnnotationElement[];
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
  readonly elements: readonly AnnotationElement[];
}

function pixelInkBounds(stroke: AnnotationElement, ratio: number): PixelRect {
  const bounds = elementInkBounds(stroke);
  // Two extra device pixels cover antialiasing, round caps and rounding error.
  const x = Math.floor(bounds.minX * ratio) - 2;
  const y = Math.floor(bounds.minY * ratio) - 2;
  return {
    x,
    y,
    width: Math.ceil(bounds.maxX * ratio) + 2 - x,
    height: Math.ceil(bounds.maxY * ratio) + 2 - y,
  };
}

function sameSurface(
  previous: CommittedRenderState,
  next: CommittedRenderState,
) {
  return (
    previous.displayId === next.displayId &&
    previous.viewportWidth === next.viewportWidth &&
    previous.viewportHeight === next.viewportHeight &&
    previous.canvasWidth === next.canvasWidth &&
    previous.canvasHeight === next.canvasHeight &&
    previous.pixelRatio === next.pixelRatio
  );
}

function rectsOverlap(a: PixelRect, b: PixelRect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** The inputs retain immutable stroke references, not just IDs that can hide geometry changes. */
export function planCommittedRender(
  previous: CommittedRenderState | null,
  next: CommittedRenderState,
): CommittedRenderPlan {
  if (!previous || !sameSurface(previous, next))
    return {
      kind: "full",
      clear: { x: 0, y: 0, width: next.canvasWidth, height: next.canvasHeight },
      elements: next.elements,
    };
  let prefix = 0;
  while (
    prefix < previous.elements.length &&
    prefix < next.elements.length &&
    previous.elements[prefix] === next.elements[prefix]
  )
    prefix += 1;
  if (prefix === previous.elements.length)
    return {
      kind: prefix === next.elements.length ? "none" : "append",
      clear: null,
      elements: next.elements.slice(prefix),
    };

  const before = new Map(previous.elements.map((stroke) => [stroke.id, stroke]));
  const after = new Map(next.elements.map((stroke) => [stroke.id, stroke]));
  const changed = [
    ...previous.elements.filter((stroke) => after.get(stroke.id) !== stroke),
    ...next.elements.filter((stroke) => before.get(stroke.id) !== stroke),
  ];
  // A changed relative stacking order affects alpha even when no ID or point changes.
  const retained = previous.elements.filter(
    (stroke) => after.get(stroke.id) === stroke,
  );
  let retainedIndex = 0;
  for (const stroke of next.elements) {
    if (
      before.get(stroke.id) === stroke &&
      retained[retainedIndex++] !== stroke
    ) {
      changed.push(...previous.elements, ...next.elements);
      break;
    }
  }
  let left = next.canvasWidth,
    top = next.canvasHeight,
    right = 0,
    bottom = 0;
  for (const stroke of changed) {
    const bounds = pixelInkBounds(stroke, next.pixelRatio);
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }
  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(next.canvasWidth, right);
  bottom = Math.min(next.canvasHeight, bottom);
  if (left >= right || top >= bottom)
    return { kind: "none", clear: null, elements: [] };
  const clear = { x: left, y: top, width: right - left, height: bottom - top };
  // Include unchanged intersecting elements in original z-order, and draw each only once.
  return {
    kind: "dirty",
    clear,
    elements: next.elements.filter((stroke) =>
      rectsOverlap(pixelInkBounds(stroke, next.pixelRatio), clear),
    ),
  };
}
