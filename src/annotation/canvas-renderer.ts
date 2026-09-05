import type { AnnotationElement } from "./history.js";
import { elementInkPaths } from "./shape-geometry.js";
import { annotationTextFont, TEXT_LINE_HEIGHT } from "./text.js";
import {
  planCommittedRender,
  type CommittedRenderState,
  type PixelRect,
} from "./render-plan.js";

interface StagingSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

// One reusable off-DOM surface per committed canvas; no per-stroke bitmap cache.
const stagingSurfaces = new WeakMap<CanvasRenderingContext2D, StagingSurface>();

export function drawAnnotationElement(context: CanvasRenderingContext2D, element: AnnotationElement) {
  if (!element.points.length) return;
  context.save();
  try {
    context.globalAlpha = element.opacity;
    context.strokeStyle = element.color;
    context.fillStyle = element.color;
    if (element.tool === "text") {
      context.translate(element.points[0].x, element.points[0].y);
      context.scale(element.scaleX, element.scaleY);
      context.font = annotationTextFont(element.fontSize);
      context.textAlign = "left";
      context.textBaseline = "alphabetic";
      context.direction = "ltr";
      element.text.split("\n").forEach((line, index) => {
        context.fillText(line, 0, element.fontSize * (1 + index * TEXT_LINE_HEIGHT));
      });
      return;
    }
    context.lineWidth = element.width;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    if (element.tool === "ellipse") {
      const [a, b] = element.points;
      const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      if (rx && ry) context.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, rx, ry, 0, 0, Math.PI * 2);
      else { context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); }
    } else {
      for (const points of elementInkPaths(element)) {
        if (points.length === 1) {
          context.moveTo(points[0].x + element.width / 2, points[0].y);
          context.arc(points[0].x, points[0].y, element.width / 2, 0, Math.PI * 2);
          context.fill();
          return;
        }
        context.moveTo(points[0].x, points[0].y);
        for (let i = 1;i < points.length;i++) context.lineTo(points[i].x, points[i].y);
      }
    }
    context.stroke();
  } finally { context.restore(); }
}

function composeDirtyRegion(
  target: CanvasRenderingContext2D,
  state: CommittedRenderState,
  region: PixelRect,
  elements: readonly AnnotationElement[],
) {
  let surface = stagingSurfaces.get(target);
  if (!surface) {
    const canvas = target.canvas.ownerDocument.createElement("canvas");
    const context = canvas.getContext("2d", target.getContextAttributes());
    if (!context) throw new Error("Cannot create annotation recomposition surface");
    surface = { canvas, context };
    stagingSurfaces.set(target, surface);
  }
  const { canvas, context } = surface;
  if (canvas.width !== state.canvasWidth) canvas.width = state.canvasWidth;
  if (canvas.height !== state.canvasHeight) canvas.height = state.canvasHeight;
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.clearRect(region.x, region.y, region.width, region.height);
    context.setTransform(state.pixelRatio, 0, 0, state.pixelRatio, 0, 0);
    // Rasterize with the original full-canvas viewport and WITHOUT a dirty clip:
    // Chromium's clipped stroke rasterization can change antialiasing at clip edges.
    // Pixels outside region are scratch data and are never copied; every copied
    // region is cleared before recomposition on its next use.
    for (const stroke of elements) drawAnnotationElement(context, stroke);
  } finally {
    context.restore();
  }
  return canvas;
}

/** Recompose ordered ink offscreen, then copy just the integer device-pixel region. */
export function paintCommittedAnnotations(
  context: CanvasRenderingContext2D,
  previous: CommittedRenderState | null,
  next: CommittedRenderState,
) {
  const plan = planCommittedRender(previous, next);
  if (plan.kind === "none") return plan;
  let patch: HTMLCanvasElement | null = null;
  if (plan.kind === "dirty" && plan.elements.length) {
    if (!plan.clear) throw new Error("Dirty annotation plan requires a region");
    // Do not damage the visible canvas if recomposition itself fails.
    patch = composeDirtyRegion(context, next, plan.clear, plan.elements);
  }
  context.save();
  try {
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.setTransform(1, 0, 0, 1, 0, 0);
    if (plan.clear) {
      const { x, y, width, height } = plan.clear;
      context.clearRect(x, y, width, height);
      if (patch) {
        context.imageSmoothingEnabled = false;
        context.drawImage(patch, x, y, width, height, x, y, width, height);
        return plan;
      }
    }
    context.setTransform(next.pixelRatio, 0, 0, next.pixelRatio, 0, 0);
    for (const stroke of plan.elements) drawAnnotationElement(context, stroke);
  } finally {
    context.restore();
  }
  return plan;
}
