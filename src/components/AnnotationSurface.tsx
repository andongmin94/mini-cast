import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  eraserSweepHitsStroke,
  pointHitsStroke,
} from "@/annotation/geometry";
import type {
  AnnotationDocumentSnapshot,
  AnnotationPoint,
  AnnotationStroke,
  StrokeTool,
} from "@/annotation/history";
import type { AnnotationTool, OverlaySettings } from "@/electron/contract";

interface AnnotationSurfaceProps {
  tool: AnnotationTool;
  settings: OverlaySettings;
  displayId: number | null;
  document: AnnotationDocumentSnapshot | null;
}

interface ActiveStroke extends Omit<AnnotationStroke, "points"> {
  points: AnnotationPoint[];
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

function clearCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
}

function resizeCanvas(canvas: HTMLCanvasElement) {
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
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function configureStroke(
  context: CanvasRenderingContext2D,
  stroke: AnnotationStroke,
) {
  context.globalAlpha = stroke.opacity;
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: AnnotationStroke,
) {
  if (!stroke.points.length) return;

  context.save();
  configureStroke(context, stroke);
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

function drawActiveSegments(
  canvas: HTMLCanvasElement | null,
  stroke: ActiveStroke,
  previousLength: number,
) {
  if (!canvas || !stroke.points.length) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.save();
  configureStroke(context, stroke);
  if (previousLength === 0) {
    const point = stroke.points[0];
    context.beginPath();
    context.arc(point.x, point.y, stroke.width / 2, 0, Math.PI * 2);
    context.fill();
  }

  const startIndex = Math.max(1, previousLength);
  if (startIndex < stroke.points.length) {
    context.beginPath();
    const start = stroke.points[startIndex - 1];
    context.moveTo(start.x, start.y);
    for (let index = startIndex; index < stroke.points.length; index += 1) {
      const point = stroke.points[index];
      context.lineTo(point.x, point.y);
    }
    context.stroke();
  }
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
  displayId,
  document,
}: AnnotationSurfaceProps) {
  const committedCanvasRef = useRef<HTMLCanvasElement>(null);
  const gestureCanvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<AnnotationDocumentSnapshot | null>(document);
  const pendingStrokesRef = useRef<Map<string, AnnotationStroke>>(new Map());
  const pendingRemovalIdsRef = useRef<Set<string>>(new Set());
  const activePointerRef = useRef<number | null>(null);
  const activeStrokeRef = useRef<ActiveStroke | null>(null);
  const eraserBaseRef = useRef<readonly AnnotationStroke[] | null>(null);
  const activeErasedIdsRef = useRef<Set<string>>(new Set());
  const lastEraserPointRef = useRef<AnnotationPoint | null>(null);
  const eraserRadiusRef = useRef(settings.annotationEraserWidth / 2);

  const interactive = tool !== "pass-through" && displayId !== null;

  const visibleStrokes = useCallback(() => {
    const committed = documentRef.current?.strokes ?? [];
    const committedIds = new Set(committed.map((stroke) => stroke.id));
    const pending = [...pendingStrokesRef.current.values()].filter(
      (stroke) => !committedIds.has(stroke.id),
    );
    const hidden = new Set([
      ...pendingRemovalIdsRef.current,
      ...activeErasedIdsRef.current,
    ]);
    return [...committed, ...pending].filter(
      (stroke) => !hidden.has(stroke.id),
    );
  }, []);

  const renderCommitted = useCallback(() => {
    const canvas = committedCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    visibleStrokes().forEach((stroke) => drawStroke(context, stroke));
  }, [visibleStrokes]);

  const clearGesture = useCallback(() => {
    clearCanvas(gestureCanvasRef.current);
  }, []);

  const finishGestureState = useCallback(() => {
    const wasActive = activePointerRef.current !== null;
    activePointerRef.current = null;
    activeStrokeRef.current = null;
    eraserBaseRef.current = null;
    activeErasedIdsRef.current = new Set();
    lastEraserPointRef.current = null;
    clearGesture();
    if (wasActive && typeof miniCast !== "undefined") {
      miniCast.setAnnotationGestureActive(false);
    }
  }, [clearGesture]);

  const cancelGesture = useCallback(() => {
    finishGestureState();
    renderCommitted();
  }, [finishGestureState, renderCommitted]);

  useLayoutEffect(() => {
    const committed = committedCanvasRef.current;
    const gesture = gestureCanvasRef.current;
    if (!committed || !gesture) return;

    const resize = () => {
      resizeCanvas(committed);
      resizeCanvas(gesture);
      clearGesture();
      renderCommitted();
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(committed);
    return () => observer.disconnect();
  }, [clearGesture, renderCommitted]);

  useEffect(() => {
    documentRef.current = document;
    if (document) {
      const committedIds = new Set(document.strokes.map((stroke) => stroke.id));
      pendingStrokesRef.current.forEach((_stroke, id) => {
        if (committedIds.has(id)) pendingStrokesRef.current.delete(id);
      });
      pendingRemovalIdsRef.current.forEach((id) => {
        if (!committedIds.has(id)) pendingRemovalIdsRef.current.delete(id);
      });
    }
    renderCommitted();
  }, [document, renderCommitted]);

  useEffect(() => {
    pendingStrokesRef.current.clear();
    pendingRemovalIdsRef.current.clear();
    cancelGesture();
  }, [cancelGesture, displayId]);

  useEffect(() => {
    cancelGesture();
  }, [cancelGesture, tool]);

  useEffect(() => {
    if (typeof miniCast === "undefined") return;
    return miniCast.onAnnotationGestureCancel(cancelGesture);
  }, [cancelGesture]);

  function appendStrokePoints(points: readonly AnnotationPoint[]) {
    const active = activeStrokeRef.current;
    if (!active) return;

    const previousLength = active.points.length;
    points.forEach((point) => {
      const last = active.points[active.points.length - 1];
      const dx = (last?.x ?? point.x) - point.x;
      const dy = (last?.y ?? point.y) - point.y;
      if (!last || dx * dx + dy * dy >= MIN_POINT_DISTANCE_SQUARED) {
        active.points.push(point);
      }
    });
    if (active.points.length !== previousLength) {
      drawActiveSegments(gestureCanvasRef.current, active, previousLength);
    }
  }

  function previewErase(points: readonly AnnotationPoint[]) {
    const base = eraserBaseRef.current;
    if (!base) return;

    let changed = false;
    points.forEach((point) => {
      const previous = lastEraserPointRef.current;
      base.forEach((stroke) => {
        if (activeErasedIdsRef.current.has(stroke.id)) return;
        const hit = previous
          ? eraserSweepHitsStroke(
              previous,
              point,
              stroke,
              eraserRadiusRef.current,
            )
          : pointHitsStroke(point, stroke, eraserRadiusRef.current);
        if (hit) {
          activeErasedIdsRef.current.add(stroke.id);
          changed = true;
        }
      });
      lastEraserPointRef.current = point;
    });
    if (changed) renderCommitted();
  }

  function commitGesture() {
    const stroke = activeStrokeRef.current;
    const erasedIds = [...activeErasedIdsRef.current];

    if (stroke && typeof miniCast !== "undefined") {
      const committed: AnnotationStroke = {
        ...stroke,
        points: [...stroke.points],
      };
      pendingStrokesRef.current.set(committed.id, committed);
      miniCast.commitAnnotationStroke(committed);
    }
    if (erasedIds.length && typeof miniCast !== "undefined") {
      erasedIds.forEach((id) => pendingRemovalIdsRef.current.add(id));
      miniCast.removeAnnotationStrokes(erasedIds);
    }

    finishGestureState();
    renderCommitted();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!interactive || activePointerRef.current !== null) return;
    if (!event.isPrimary || event.button !== 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    if (typeof miniCast !== "undefined") {
      miniCast.setAnnotationGestureActive(true);
    }

    const point = { x: event.clientX, y: event.clientY };
    if (tool === "eraser") {
      eraserBaseRef.current = visibleStrokes();
      activeErasedIdsRef.current = new Set();
      lastEraserPointRef.current = null;
      eraserRadiusRef.current = settings.annotationEraserWidth / 2;
      previewErase([point]);
      return;
    }

    const activeTool: StrokeTool =
      tool === "highlighter" ? "highlighter" : "pen";
    activeStrokeRef.current = {
      id: crypto.randomUUID(),
      tool: activeTool,
      points: [point],
      ...strokeStyle(activeTool, settings),
    };
    clearGesture();
    drawActiveSegments(gestureCanvasRef.current, activeStrokeRef.current, 0);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;

    const points = pointerPoints(event);
    if (eraserBaseRef.current) previewErase(points);
    else appendStrokePoints(points);
  }

  function releasePointer(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;

    handlePointerMove(event);
    commitGesture();
    releasePointer(event);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;

    cancelGesture();
    releasePointer(event);
  }

  return (
    <>
      <canvas
        ref={committedCanvasRef}
        className="pointer-events-none fixed inset-0 size-full"
        style={{ zIndex: 1 }}
        aria-hidden="true"
      />
      <canvas
        ref={gestureCanvasRef}
        className="fixed inset-0 size-full"
        style={{
          zIndex: 2,
          pointerEvents: interactive ? "auto" : "none",
          touchAction: "none",
          cursor: interactive ? "none" : "default",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        aria-hidden="true"
      />
    </>
  );
}
