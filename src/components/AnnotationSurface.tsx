import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { distanceSquared, pointHitsStroke } from "@/annotation/geometry";
import {
  AnnotationHistory,
  type AnnotationPoint,
  type AnnotationStroke,
  type StrokeTool,
} from "@/annotation/history";
import type {
  AnnotationCommand,
  AnnotationTool,
  OverlaySettings,
} from "@/electron/contract";

interface AnnotationSurfaceProps {
  tool: AnnotationTool;
  settings: OverlaySettings;
}

const MIN_POINT_DISTANCE_SQUARED = 0.75 * 0.75;

function pointerPoints(event: ReactPointerEvent<HTMLCanvasElement>) {
  const nativeEvents = event.nativeEvent.getCoalescedEvents?.() ?? [];
  const events = nativeEvents.length ? nativeEvents : [event.nativeEvent];
  return events.map<AnnotationPoint>((item) => ({
    x: item.clientX,
    y: item.clientY,
  }));
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: AnnotationStroke,
) {
  if (!stroke.points.length) return;

  context.save();
  context.globalAlpha = stroke.opacity;
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    context.beginPath();
    context.arc(point.x, point.y, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let index = 1; index < stroke.points.length; index += 1) {
    const previous = stroke.points[index - 1];
    const current = stroke.points[index];
    const middleX = (previous.x + current.x) / 2;
    const middleY = (previous.y + current.y) / 2;
    context.quadraticCurveTo(previous.x, previous.y, middleX, middleY);
  }
  const last = stroke.points[stroke.points.length - 1];
  context.lineTo(last.x, last.y);
  context.stroke();
  context.restore();
}

function strokeStyle(tool: StrokeTool, settings: OverlaySettings) {
  return tool === "highlighter"
    ? {
        color: settings.annotationHighlighterColor,
        width: settings.annotationHighlighterWidth,
        opacity: 0.35,
      }
    : {
        color: settings.annotationPenColor,
        width: settings.annotationPenWidth,
        opacity: 1,
      };
}

export default function AnnotationSurface({
  tool,
  settings,
}: AnnotationSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef(new AnnotationHistory());
  const activePointerRef = useRef<number | null>(null);
  const activeStrokeRef = useRef<AnnotationStroke | null>(null);
  const eraserBaseRef = useRef<readonly AnnotationStroke[] | null>(null);
  const erasedIdsRef = useRef<Set<string>>(new Set());
  const eraserRadiusRef = useRef(settings.annotationEraserWidth / 2);
  const [revision, setRevision] = useState(0);

  const interactive = tool !== "pass-through";

  const invalidate = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  const cancelGesture = useCallback(() => {
    activePointerRef.current = null;
    activeStrokeRef.current = null;
    eraserBaseRef.current = null;
    erasedIdsRef.current = new Set();
    invalidate();
  }, [invalidate]);

  function commitGesture() {
    const stroke = activeStrokeRef.current;
    const erasedIds = [...erasedIdsRef.current];

    activePointerRef.current = null;
    activeStrokeRef.current = null;
    eraserBaseRef.current = null;
    erasedIdsRef.current = new Set();

    if (stroke) historyRef.current.addStroke(stroke);
    if (erasedIds.length) historyRef.current.removeStrokes(erasedIds);
    invalidate();
  }

  const applyCommand = useCallback((command: AnnotationCommand) => {
    cancelGesture();

    if (command === "undo") historyRef.current.undo();
    if (command === "redo") historyRef.current.redo();
    if (command === "clear") historyRef.current.clear();
    invalidate();
  }, [cancelGesture, invalidate]);

  useEffect(() => {
    cancelGesture();
  }, [cancelGesture, tool]);

  useEffect(() => {
    if (typeof miniCast === "undefined") return;
    return miniCast.onAnnotationCommand(applyCommand);
  }, [applyCommand]);

  useEffect(() => {
    const resize = () => invalidate();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [invalidate]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const erasedIds = erasedIdsRef.current;
    const base = eraserBaseRef.current ?? historyRef.current.getSnapshot();
    base.forEach((stroke) => {
      if (!erasedIds.has(stroke.id)) drawStroke(context, stroke);
    });

    if (activeStrokeRef.current) {
      drawStroke(context, activeStrokeRef.current);
    }
  }, [revision, settings]);

  function appendStrokePoints(points: readonly AnnotationPoint[]) {
    const active = activeStrokeRef.current;
    if (!active) return;

    const nextPoints = [...active.points];
    points.forEach((point) => {
      const last = nextPoints[nextPoints.length - 1];
      if (!last || distanceSquared(last, point) >= MIN_POINT_DISTANCE_SQUARED) {
        nextPoints.push(point);
      }
    });
    activeStrokeRef.current = { ...active, points: nextPoints };
    invalidate();
  }

  function previewErase(points: readonly AnnotationPoint[]) {
    const base = eraserBaseRef.current;
    if (!base) return;

    let changed = false;
    points.forEach((point) => {
      base.forEach((stroke) => {
        if (
          !erasedIdsRef.current.has(stroke.id) &&
          pointHitsStroke(point, stroke, eraserRadiusRef.current)
        ) {
          erasedIdsRef.current.add(stroke.id);
          changed = true;
        }
      });
    });
    if (changed) invalidate();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!interactive || activePointerRef.current !== null) return;
    if (!event.isPrimary || event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    miniCast.notifyAnnotationInteraction();

    const point = { x: event.clientX, y: event.clientY };
    if (tool === "eraser") {
      eraserBaseRef.current = historyRef.current.getSnapshot();
      erasedIdsRef.current = new Set();
      eraserRadiusRef.current = settings.annotationEraserWidth / 2;
      previewErase([point]);
      return;
    }

    const activeTool: StrokeTool =
      tool === "highlighter" ? "highlighter" : "pen";
    const style = strokeStyle(activeTool, settings);
    activeStrokeRef.current = {
      id: crypto.randomUUID(),
      tool: activeTool,
      points: [point],
      ...style,
    };
    invalidate();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;

    const points = pointerPoints(event);
    if (eraserBaseRef.current) {
      previewErase(points);
    } else {
      appendStrokePoints(points);
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;

    handlePointerMove(event);
    commitGesture();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;

    cancelGesture();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 size-full"
      style={{
        zIndex: 1,
        pointerEvents: interactive ? "auto" : "none",
        touchAction: "none",
        cursor: interactive ? "none" : "default",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={cancelGesture}
      aria-hidden="true"
    />
  );
}
