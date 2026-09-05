import type { AnnotationStroke } from "./history.js";
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

export function drawAnnotationStroke(
  context: CanvasRenderingContext2D,
  stroke: AnnotationStroke,
) {
  if (!stroke.points.length) return;
  context.save();
  try {
    context.globalAlpha = stroke.opacity;
    context.strokeStyle = stroke.color;
    context.fillStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      context.arc(point.x, point.y, stroke.width / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let index = 1; index < stroke.points.length; index += 1)
        context.lineTo(stroke.points[index].x, stroke.points[index].y);
      context.stroke();
    }
  } finally {
    context.restore();
  }
}

function composeDirtyRegion(
  target: CanvasRenderingContext2D,
  state: CommittedRenderState,
  region: PixelRect,
  strokes: readonly AnnotationStroke[],
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
    for (const stroke of strokes) drawAnnotationStroke(context, stroke);
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
  if (plan.kind === "dirty" && plan.strokes.length) {
    if (!plan.clear) throw new Error("Dirty annotation plan requires a region");
    // Do not damage the visible canvas if recomposition itself fails.
    patch = composeDirtyRegion(context, next, plan.clear, plan.strokes);
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
    for (const stroke of plan.strokes) drawAnnotationStroke(context, stroke);
  } finally {
    context.restore();
  }
  return plan;
}
