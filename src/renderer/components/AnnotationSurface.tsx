import { shapeControlPoints, framePoint } from "@/annotation/primitive-frame";
import { constrainedShapeEnd, hasShapeExtent } from "@/annotation/shape-geometry";
import { isShapeTool, type StrokeElement, type ShapeElement, type TextElement } from "@/annotation/history";
import { annotationTextFont, createTextElement, type AnnotationTextDraft } from "@/annotation/text";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { AnnotationDocumentUpdate } from "@/annotation/document-sync";
import { paintCommittedAnnotations, drawAnnotationElement } from "@/annotation/canvas-renderer";
import { annotationFailureMessage } from "@/annotation/errors";
import { shouldAdoptAnnotationDocument } from "@/annotation/document-order";
import {
  prepareEraserElement,
  eraserSweepHitsPreparedElement,
  type PreparedEraserElement,
} from "@/annotation/eraser-index";
import { MAX_ANNOTATION_POINTS_PER_STROKE } from "@/annotation/history";
import type {
  AnnotationDocumentSnapshot,
  AnnotationPoint,
  AnnotationElement,
  StrokeTool,
} from "@/annotation/history";
import { type CommittedRenderState } from "@/annotation/render-plan";
import type { AnnotationTool, OverlaySettings } from "@/shared/contract";

interface AnnotationSurfaceProps {
  tool: AnnotationTool;
  textDraft: AnnotationTextDraft | null;
  settings: OverlaySettings;
  displayId: number | null;
  document: AnnotationDocumentSnapshot | null;
  onDocumentUpdate(
    update: AnnotationDocumentUpdate,
  ): Promise<AnnotationDocumentSnapshot | null>;
}

interface ActiveStroke extends Omit<StrokeElement, "points"> {
  points: AnnotationPoint[];
}

const MIN_POINT_DISTANCE_SQUARED = 0.75 * 0.75;

function pointerPoints(event: ReactPointerEvent<HTMLCanvasElement>) {
  const nativeEvents = event.nativeEvent.getCoalescedEvents?.() ?? [];
  const events = nativeEvents.length ? nativeEvents : [event.nativeEvent];
  const width = Math.max(event.currentTarget.clientWidth, 1);
  const height = Math.max(event.currentTarget.clientHeight, 1);
  return events.map<AnnotationPoint>((item) => ({
    x: Math.min(width, Math.max(0, item.clientX)),
    y: Math.min(height, Math.max(0, item.clientY)),
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
  stroke: StrokeElement,
  opacity = stroke.opacity,
) {
  context.globalAlpha = opacity;
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineCap = "round";
  context.lineJoin = "round";
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
  configureStroke(
    context,
    stroke,
    stroke.tool === "highlighter" ? 1 : stroke.opacity,
  );
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
    for (let index = startIndex;index < stroke.points.length;index += 1) {
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

function AnnotationSurface({
  tool,
  textDraft,
  settings,
  displayId,
  document,
  onDocumentUpdate,
}: AnnotationSurfaceProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const committedCanvasRef = useRef<HTMLCanvasElement>(null);
  const gestureCanvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<AnnotationDocumentSnapshot | null>(document);
  const currentDisplayIdRef = useRef<number | null>(displayId);
  const committedRenderStateRef = useRef<CommittedRenderState | null>(null);
  const pendingElementsRef = useRef<Map<string, AnnotationElement>>(new Map());
  const pendingRemovalIdsRef = useRef<Set<string>>(new Set());
  const activePointerRef = useRef<number | null>(null);
  const activeGestureIdRef = useRef<string | null>(null);
  const fontsReadyRef = useRef(false);
  const activeObjectRef = useRef<ShapeElement | TextElement | null>(null);
  const objectFrameRef = useRef<number | null>(null);
  const activeStrokeRef = useRef<ActiveStroke | null>(null);
  const eraserBaseRef = useRef<readonly PreparedEraserElement[] | null>(null);
  const eraserFrameRef = useRef<number | null>(null);
  const activeErasedIdsRef = useRef<Set<string>>(new Set());
  const lastEraserPointRef = useRef<AnnotationPoint | null>(null);
  const eraserRadiusRef = useRef(settings.annotationEraserWidth / 2);

  const interactive = tool !== "pass-through" && displayId !== null;

  useLayoutEffect(() => {
    currentDisplayIdRef.current = displayId;
  }, [displayId]);

  const visibleStrokes = useCallback(() => {
    const committed = documentRef.current?.elements ?? [];
    if (
      !pendingElementsRef.current.size &&
      !pendingRemovalIdsRef.current.size &&
      !activeErasedIdsRef.current.size
    )
      return committed;
    const committedIds = new Set(committed.map((stroke) => stroke.id));
    const pending = [...pendingElementsRef.current.values()].filter(
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

  const renderCommitted = useCallback(
    (forceReset = false) => {
      const canvas = committedCanvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d");
      if (!context) return;

      const elements = visibleStrokes();
      const viewport = documentRef.current?.viewport ?? null;
      const nextState: CommittedRenderState = {
        displayId: currentDisplayIdRef.current,
        viewportWidth: viewport?.width ?? null,
        viewportHeight: viewport?.height ?? null,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        pixelRatio: Math.max(window.devicePixelRatio || 1, 1),
        elements,
      };
      paintCommittedAnnotations(
        context,
        forceReset ? null : committedRenderStateRef.current,
        nextState,
      );
      committedRenderStateRef.current = nextState;
    },
    [visibleStrokes],
  );

  const reconcilePendingWithDocument = useCallback(
    (next: AnnotationDocumentSnapshot) => {
      if (!pendingElementsRef.current.size && !pendingRemovalIdsRef.current.size)
        return;
      const committedIds = new Set(next.elements.map((stroke) => stroke.id));
      pendingElementsRef.current.forEach((_stroke, id) => {
        if (committedIds.has(id)) pendingElementsRef.current.delete(id);
      });
      pendingRemovalIdsRef.current.forEach((id) => {
        if (!committedIds.has(id)) pendingRemovalIdsRef.current.delete(id);
      });
    },
    [],
  );

  const adoptAuthoritativeDocument = useCallback(
    (next: AnnotationDocumentSnapshot) => {
      const currentRevision = documentRef.current?.revision ?? -1;
      if (
        !shouldAdoptAnnotationDocument(
          currentDisplayIdRef.current,
          currentRevision,
          next,
        )
      ) {
        return false;
      }

      documentRef.current = next;
      reconcilePendingWithDocument(next);
      return true;
    },
    [reconcilePendingWithDocument],
  );

  const cancelEraserPaint = useCallback(() => {
    if (eraserFrameRef.current !== null)
      cancelAnimationFrame(eraserFrameRef.current);
    eraserFrameRef.current = null;
  }, []);

  const clearGesture = useCallback(() => {
    if (objectFrameRef.current !== null) cancelAnimationFrame(objectFrameRef.current);
    objectFrameRef.current = null;
    clearCanvas(gestureCanvasRef.current);
  }, []);

  const finishGestureState = useCallback(
    (notifyMain: boolean) => {
      cancelEraserPaint();
      const gestureId = activeGestureIdRef.current;
      const pointerId = activePointerRef.current;
      const gestureCanvas = gestureCanvasRef.current;
      if (gestureCanvas) delete gestureCanvas.dataset.activeGesture;
      activePointerRef.current = null;
      activeGestureIdRef.current = null;
      activeStrokeRef.current = null;
      activeObjectRef.current = null;
      eraserBaseRef.current = null;
      activeErasedIdsRef.current = new Set();
      lastEraserPointRef.current = null;
      if (pointerId !== null && gestureCanvas?.hasPointerCapture(pointerId)) {
        try {
          gestureCanvas.releasePointerCapture(pointerId);
        } catch {
          // Native pointer teardown can race tool and window changes.
        }
      }
      clearGesture();
      if (notifyMain && gestureId && typeof miniCast !== "undefined") {
        miniCast.endAnnotationGesture(gestureId);
      }
    },
    [cancelEraserPaint, clearGesture],
  );

  useEffect(() => () => finishGestureState(true), [finishGestureState]);

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
      renderCommitted(true);
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(committed);
    return () => observer.disconnect();
  }, [clearGesture, renderCommitted]);

  useEffect(() => {
    documentRef.current = null;
    committedRenderStateRef.current = null;
    pendingElementsRef.current.clear();
    pendingRemovalIdsRef.current.clear();
    cancelGesture();
    renderCommitted(true);
  }, [cancelGesture, displayId, renderCommitted]);

  useEffect(() => {
    if (!document) {
      documentRef.current = null;
      committedRenderStateRef.current = null;
      renderCommitted(true);
      return;
    }

    if (adoptAuthoritativeDocument(document)) renderCommitted();
  }, [adoptAuthoritativeDocument, document, renderCommitted]);

  useEffect(() => {
    cancelGesture();
  }, [cancelGesture, tool]);

  useEffect(() => {
    if (typeof miniCast === "undefined") return;
    return miniCast.onAnnotationGestureCancel(cancelGesture);
  }, [cancelGesture]);

  useEffect(() => {
    let active = true;
    void window.document.fonts.load(annotationTextFont(28), "가나다ABC")
      .then(faces => {
        if (!active) return;
        if (!faces.length) throw new Error("Annotation font is not available");
        fontsReadyRef.current = true;
        renderCommitted(true);
      })
      .catch(() => { if (active) setNotice("판서 글꼴을 불러오지 못했습니다. 텍스트 배치를 사용할 수 없습니다."); });
    return () => { active = false; };
  }, [renderCommitted]);

  function paintActiveObject() {
    const canvas = gestureCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !activeObjectRef.current) return;
    clearCanvas(canvas);
    drawAnnotationElement(context, activeObjectRef.current);
  }

  function updateObjectPreview(point: AnnotationPoint, shift: boolean) {
    const object = activeObjectRef.current;
    if (!object || object.tool === "text") return;
    activeObjectRef.current = { ...object, points: shapeControlPoints(object.tool, object.points[0], constrainedShapeEnd(object.tool, object.points[0], point, shift)) };
    if (objectFrameRef.current !== null) return;
    const gestureId = activeGestureIdRef.current;
    objectFrameRef.current = requestAnimationFrame(() => {
      objectFrameRef.current = null;
      if (activeGestureIdRef.current === gestureId) paintActiveObject();
    });
  }

  function appendStrokePoints(points: readonly AnnotationPoint[]) {
    const active = activeStrokeRef.current;
    if (!active) return;

    const previousLength = active.points.length;
    for (const point of points) {
      if (active.points.length >= MAX_ANNOTATION_POINTS_PER_STROKE) break;
      const last = active.points[active.points.length - 1];
      const dx = (last?.x ?? point.x) - point.x;
      const dy = (last?.y ?? point.y) - point.y;
      if (!last || dx * dx + dy * dy >= MIN_POINT_DISTANCE_SQUARED) {
        active.points.push(point);
      }
    }
    if (active.points.length !== previousLength) {
      drawActiveSegments(gestureCanvasRef.current, active, previousLength);
    }
    if (active.points.length >= MAX_ANNOTATION_POINTS_PER_STROKE) {
      commitGesture();
      setNotice(
        "한 획의 길이 한도에 도달하여 여기까지 저장을 요청했습니다. 펜을 떼고 새 획을 시작해 주세요.",
      );
    }
  }

  function previewErase(points: readonly AnnotationPoint[]) {
    const base = eraserBaseRef.current;
    if (!base) return;

    let changed = false;
    points.forEach((point) => {
      const previous = lastEraserPointRef.current;
      base.forEach((prepared) => {
        if (activeErasedIdsRef.current.has(prepared.stroke.id)) return;
        if (
          eraserSweepHitsPreparedElement(
            previous ?? point,
            point,
            prepared,
            eraserRadiusRef.current,
          )
        ) {
          activeErasedIdsRef.current.add(prepared.stroke.id);
          changed = true;
        }
      });
      lastEraserPointRef.current = point;
    });
    if (changed && eraserFrameRef.current === null) {
      const gestureId = activeGestureIdRef.current;
      eraserFrameRef.current = requestAnimationFrame(() => {
        eraserFrameRef.current = null;
        if (gestureId === activeGestureIdRef.current) renderCommitted();
      });
    }
  }

  function commitGesture() {
    const gestureId = activeGestureIdRef.current;
    const stroke = activeStrokeRef.current ?? activeObjectRef.current;
    const erasedIds = [...activeErasedIdsRef.current];
    if (!gestureId || typeof miniCast === "undefined") {
      finishGestureState(true);
      renderCommitted();
      return;
    }

    if (stroke && isShapeTool(stroke.tool) && !hasShapeExtent(stroke.tool, stroke.points[0], stroke.tool === "rectangle" || stroke.tool === "ellipse" ? framePoint(stroke.points, 1, 1) : stroke.points[1])) {
      finishGestureState(true);
      renderCommitted();
      return;
    }
    if (stroke) {
      const committed: AnnotationElement = {
        ...stroke,
        points: [...stroke.points],
      };
      pendingElementsRef.current.set(committed.id, committed);
      void miniCast
        .commitAnnotationElement(gestureId, committed)
        .then(async (result) => {
          const next = result.update
            ? await onDocumentUpdate(result.update)
            : null;
          if (next) adoptAuthoritativeDocument(next);
          if (!result.accepted)
            setNotice(annotationFailureMessage(result.reason));
          pendingElementsRef.current.delete(committed.id);
          renderCommitted();
        })
        .catch(() => {
          pendingElementsRef.current.delete(committed.id);
          setNotice("판서 통신이 끊겼습니다. 저장 상태를 다시 확인합니다.");
          renderCommitted();
          void miniCast
            .getAnnotationDocument()
            .then(async (next) => {
              const current = await onDocumentUpdate({
                kind: "snapshot",
                document: next,
              });
              if (current && adoptAuthoritativeDocument(current))
                renderCommitted();
            })
            .catch(() =>
              setNotice(
                "판서 상태를 확인할 수 없습니다. 앱 연결을 확인해 주세요.",
              ),
            );
        })
        .finally(() => miniCast.endAnnotationGesture(gestureId));
    } else if (erasedIds.length) {
      erasedIds.forEach((id) => pendingRemovalIdsRef.current.add(id));
      void miniCast
        .removeAnnotationElements(gestureId, erasedIds)
        .then(async (result) => {
          const next = result.update
            ? await onDocumentUpdate(result.update)
            : null;
          if (next) adoptAuthoritativeDocument(next);
          if (!result.accepted)
            setNotice(annotationFailureMessage(result.reason));
          erasedIds.forEach((id) => pendingRemovalIdsRef.current.delete(id));
          renderCommitted();
        })
        .catch(() => {
          erasedIds.forEach((id) => pendingRemovalIdsRef.current.delete(id));
          setNotice("지우기 통신이 끊겼습니다. 저장 상태를 다시 확인합니다.");
          renderCommitted();
          void miniCast
            .getAnnotationDocument()
            .then(async (next) => {
              const current = await onDocumentUpdate({
                kind: "snapshot",
                document: next,
              });
              if (current && adoptAuthoritativeDocument(current))
                renderCommitted();
            })
            .catch(() =>
              setNotice(
                "판서 상태를 확인할 수 없습니다. 앱 연결을 확인해 주세요.",
              ),
            );
        })
        .finally(() => miniCast.endAnnotationGesture(gestureId));
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
    setNotice(null);
    event.currentTarget.dataset.activeGesture = "true";
    const gestureId = crypto.randomUUID();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    activeGestureIdRef.current = gestureId;
    if (typeof miniCast !== "undefined") {
      miniCast.beginAnnotationGesture(gestureId);
    }

    const point = pointerPoints(event)[0];
    if (tool === "eraser") {
      eraserBaseRef.current = visibleStrokes().map(prepareEraserElement);
      activeErasedIdsRef.current = new Set();
      lastEraserPointRef.current = null;
      eraserRadiusRef.current = settings.annotationEraserWidth / 2;
      previewErase([point]);
      return;
    }

    if (tool === "text") {
      if (!textDraft || !fontsReadyRef.current) {
        cancelGesture();
        setNotice(textDraft ? "글꼴을 준비 중입니다. 잠시 뒤 다시 배치해 주세요." : "컨트롤러에서 글자를 입력하고 ‘화면에 배치’를 눌러 주세요.");
        return;
      }
      const context = gestureCanvasRef.current?.getContext("2d");
      if (!context) { cancelGesture(); return; }
      try {
        activeObjectRef.current = createTextElement(context, crypto.randomUUID(), textDraft, point, settings.annotationPenColor);
        clearGesture();
        paintActiveObject();
      } catch {
        cancelGesture();
        setNotice("텍스트를 준비하지 못했습니다. 입력 내용과 글꼴을 확인해 주세요.");
      }
      return;
    }
    if (isShapeTool(tool)) {
      activeObjectRef.current = { id: crypto.randomUUID(), tool, points: shapeControlPoints(tool, point, point), color: settings.annotationPenColor, width: settings.annotationPenWidth, opacity: 1 };
      clearGesture();
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
    else if (activeObjectRef.current) updateObjectPreview(points[points.length - 1], event.shiftKey);
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
          cursor: !interactive ? "default" : tool === "text" ? "text" : isShapeTool(tool) ? "crosshair" : "none",
          opacity: tool === "highlighter" ? 0.35 : 1,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        aria-hidden="true"
      />
      {notice && (
        <div
          role="alert"
          data-annotation-notice=""
          className="pointer-events-none fixed bottom-4 left-1/2 max-w-lg -translate-x-1/2 rounded-md bg-slate-900 px-4 py-3 text-sm text-white"
          style={{ zIndex: 5 }}
        >
          {notice}
        </div>
      )}
    </>
  );
}

// Cursor position and keyboard display updates do not change annotation props.
export default memo(AnnotationSurface);
