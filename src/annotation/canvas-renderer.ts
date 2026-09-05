import type { AnnotationStroke } from "./history.js";
import {
  planCommittedRender,
  type CommittedRenderState,
} from "./render-plan.js";

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

/** Clear and rebuild just the dirty region; never erase pixels from a composited layer by ID. */
export function paintCommittedAnnotations(
  context: CanvasRenderingContext2D,
  previous: CommittedRenderState | null,
  next: CommittedRenderState,
) {
  const plan = planCommittedRender(previous, next);
  if (plan.kind === "none") return plan;
  context.save();
  try {
    context.globalCompositeOperation = "source-over";
    context.setTransform(1, 0, 0, 1, 0, 0);
    if (plan.clear) {
      const { x, y, width, height } = plan.clear;
      context.beginPath();
      context.rect(x, y, width, height);
      context.clip();
      context.clearRect(x, y, width, height);
    }
    context.setTransform(next.pixelRatio, 0, 0, next.pixelRatio, 0, 0);
    for (const stroke of plan.strokes) drawAnnotationStroke(context, stroke);
  } finally {
    context.restore();
  }
  return plan;
}
