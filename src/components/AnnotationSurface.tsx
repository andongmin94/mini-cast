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
    const point = stroke.points[index];
    context.lineTo(point.x, point.y);
  }
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
  const activeGestureIdRef = useRef<string | null>(null);
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

  const finishGestureState = useCallback(
    (notifyMain: boolean) => {
      const gestureId = activeGestureIdRef.current;
      activePointerRef.current = null;
      activeGestureIdRef.current = null;
      activeStrokeRef.current = null;
      eraserBaseRef.current = null;
      activeErasedIdsRef.current = new Set();
      lastEraserPointRef.current = null;
      clearGesture();
      if (notifyMain && gestureId && typeof miniCast !== "undefined") {
        miniCast.endAnnotationGesture(gestureId);
      }
    },
    [clearGesture],
  );

  const cancelGesture = useCallback(
    (gestureId?: string) => {
      if (
        gestureId &&
        activeGestureIdRef.current &&
        gestureId !== activeGestureIdRef.current
      ) {
        return;
      }
      finishGestureState(true);
      renderCommitted();
    },
    [finishGestureState, renderCommitted],
  );

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
    const gestureId = activeGestureIdRef.current;
    const stroke = activeStrokeRef.current;
    const erasedIds = [...activeErasedIdsRef.current];
    if (!gestureId || typeof miniCast === "undefined") {
      finishGestureState(true);
      renderCommitted();
      return;
    }

    if (stroke) {
      const committed: AnnotationStroke = {
        ...stroke,
        points: [...stroke.points],
      };
      pendingStrokesRef.current.set(committed.id, committed);
      void miniCast
        .commitAnnotationStroke(gestureId, committed)
        .then((accepted) => {
          if (!accepted) pendingStrokesRef.current.delete(committed.id);
        })
        .catch(() => pendingStrokesRef.current.delete(committed.id))
        .finally(() => {
          miniCast.endAnnotationGesture(gestureId);
          renderCommitted();
        });
    } else if (erasedIds.length) {
      erasedIds.forEach((id) => pendingRemovalIdsRef.current.add(id));
      void miniCast
        .removeAnnotationStrokes(gestureId, erasedIds)
        .then((accepted) => {
          if (!accepted) {
            erasedIds.forEach((id) => pendingRemovalIdsRef.current.delete(id));
          }
        })
        .catch(() => {
          erasedIds.forEach((id) => pendingRemovalIdsRef.current.delete(id));
        })
        .finally(() => {
          miniCast.endAnnotationGesture(gestureId);
          renderCommitted();
        });
    } else {
      miniCast.endAnnotationGesture(gestureId);
    }

    finishGestureState(false);
    renderCommitted();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!interactive || activePointerRef.current !== null) return;
    if (!event.isPrimary || event.button !== 0) return;

    event.preventDefault();
    const gestureId = crypto.randomUUID();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    activeGestureIdRef.current = gestureId;
    if (typeof miniCast !== "undefined") {
      miniCast.beginAnnotationGesture(gestureId);
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
