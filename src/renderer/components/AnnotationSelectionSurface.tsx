import { memo, useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { paintCommittedAnnotations } from "@/annotation/canvas-renderer";
import type { AnnotationDocumentUpdate } from "@/annotation/document-sync";
import { annotationFailureMessage } from "@/annotation/errors";
import type { AnnotationDocumentSnapshot, AnnotationElement, AnnotationPoint } from "@/annotation/history";
import type { CommittedRenderState } from "@/annotation/render-plan";
import {
  annotationSelectionBounds, hitTestAnnotationSelection, selectionAfterClick,
  translateSelectionElements, type AnnotationSelectionEdit,
} from "@/annotation/selection";

interface Props {
  displayId: number | null;
  document: AnnotationDocumentSnapshot | null;
  onDocumentUpdate(update: AnnotationDocumentUpdate): Promise<AnnotationDocumentSnapshot | null>;
}

interface Drag {
  id: string;
  pointerId: number;
  start: AnnotationPoint;
  source: AnnotationDocumentSnapshot;
  ids: readonly string[];
  dx: number;
  dy: number;
  preview: readonly AnnotationElement[];
}

interface Pending {
  id: string;
  revision: number;
  preview: readonly AnnotationElement[] | null;
}

function pointerPosition(event: ReactPointerEvent<HTMLCanvasElement>): AnnotationPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(bounds.width, Math.max(0, event.clientX - bounds.left)),
    y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)),
  };
}

/** Selection is transient UI state. Only accepted moves/deletes enter authoritative history. */
function AnnotationSelectionSurface({ displayId, document, onDocumentUpdate }: Props) {
  const committedCanvas = useRef<HTMLCanvasElement>(null);
  const inputCanvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(document);
  const selected = useRef<readonly string[]>([]);
  const drag = useRef<Drag | null>(null);
  const pending = useRef<Pending | null>(null);
  const rendered = useRef<CommittedRenderState | null>(null);
  const frame = useRef<number | null>(null);
  const alive = useRef(false);
  const epoch = useRef(0);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const setSelection = useCallback((ids: readonly string[]) => {
    selected.current = ids;
    if (alive.current) setCount(ids.length);
  }, []);

  const paint = useCallback(() => {
    const canvas = committedCanvas.current;
    const handles = inputCanvas.current;
    const snapshot = current.current;
    if (!canvas || !handles) return;
    const context = canvas.getContext("2d");
    const selectionContext = handles.getContext("2d");
    if (!context || !selectionContext) return;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const active = drag.current;
    const waiting = pending.current;
    const elements = active && active.source.revision === snapshot?.revision
      ? active.preview
      : waiting && waiting.revision === snapshot?.revision && waiting.preview
        ? waiting.preview : snapshot?.elements ?? [];
    const next: CommittedRenderState = {
      displayId: snapshot?.displayId ?? null,
      viewportWidth: snapshot?.viewport?.width ?? null,
      viewportHeight: snapshot?.viewport?.height ?? null,
      canvasWidth: canvas.width, canvasHeight: canvas.height,
      pixelRatio: ratio, elements,
    };
    paintCommittedAnnotations(context, rendered.current, next);
    rendered.current = next;
    selectionContext.save();
    selectionContext.setTransform(1, 0, 0, 1, 0, 0);
    selectionContext.clearRect(0, 0, handles.width, handles.height);
    selectionContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    const bounds = annotationSelectionBounds(elements, new Set(selected.current));
    if (bounds) {
      selectionContext.strokeStyle = "#007AFF";
      selectionContext.lineWidth = 1;
      selectionContext.setLineDash([5, 4]);
      selectionContext.strokeRect(bounds.minX - 4, bounds.minY - 4,
        bounds.maxX - bounds.minX + 8, bounds.maxY - bounds.minY + 8);
    }
    selectionContext.restore();
  }, []);

  const requestPaint = useCallback(() => {
    if (!alive.current || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (alive.current) paint();
    });
  }, [paint]);

  const detachPointer = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    const canvas = inputCanvas.current;
    if (canvas) delete canvas.dataset.activeGesture;
    if (active && canvas?.hasPointerCapture(active.pointerId)) {
      canvas.releasePointerCapture(active.pointerId);
    }
    return active;
  }, []);

  const cancelDrag = useCallback(() => {
    const active = detachPointer();
    if (active && typeof miniCast !== "undefined") miniCast.endAnnotationGesture(active.id);
    requestPaint();
  }, [detachPointer, requestPaint]);

  useLayoutEffect(() => {
    alive.current = true;
    epoch.current += 1;
    const resize = () => {
      cancelDrag();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      for (const canvas of [committedCanvas.current, inputCanvas.current]) {
        if (!canvas) continue;
        const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
        const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          rendered.current = null;
        }
        canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      requestPaint();
    };
    resize();
    const generation = epoch.current;
    const refreshFonts = () => {
      if (!alive.current || epoch.current !== generation) return;
      rendered.current = null;
      requestPaint();
    };
    void window.document.fonts.load('400 28px "Pretendard"', '한글 ABC').then(refreshFonts).catch(() => {
      if (alive.current && epoch.current === generation) setNotice("글꼴을 불러오지 못했습니다. 텍스트 표시를 확인해 주세요.");
    });
    window.document.fonts.addEventListener("loadingdone", refreshFonts);
    const observer = new ResizeObserver(resize);
    if (committedCanvas.current) observer.observe(committedCanvas.current);
    window.addEventListener("resize", resize);
    const unsubscribe = typeof miniCast === "undefined" ? () => {} :
      miniCast.onAnnotationGestureCancel(id => {
        if (drag.current?.id === id) cancelDrag();
        if (pending.current?.id === id) {
          pending.current.preview = null;
          requestPaint();
        }
      });
    return () => {
      alive.current = false;
      epoch.current += 1;
      cancelDrag();
      if (pending.current && typeof miniCast !== "undefined") miniCast.endAnnotationGesture(pending.current.id);
      pending.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      observer.disconnect();
      window.document.fonts.removeEventListener("loadingdone", refreshFonts);
      window.removeEventListener("resize", resize);
      unsubscribe();
    };
  }, [cancelDrag, requestPaint]);

  useLayoutEffect(() => {
    const previous = current.current;
    if (previous && document && previous.displayId === document.displayId && previous.revision > document.revision) return;
    current.current = document;
    if (drag.current && (!document || document.displayId !== drag.current.source.displayId || document.revision !== drag.current.source.revision)) cancelDrag();
    const present = new Set(document?.elements.map(element => element.id) ?? []);
    const retained = selected.current.filter(id => present.has(id));
    if (retained.length !== selected.current.length) setSelection(retained);
    requestPaint();
  }, [document, cancelDrag, requestPaint, setSelection]);

  async function submit(id: string, edit: AnnotationSelectionEdit, preview: readonly AnnotationElement[]) {
    const generation = epoch.current;
    const transaction: Pending = { id, revision: edit.revision, preview };
    pending.current = transaction;
    setBusy(true);
    requestPaint();
    const isCurrent = () => alive.current && epoch.current === generation;
    const adopt = (next: AnnotationDocumentSnapshot | null) => {
      if (!isCurrent() || !next || next.displayId !== displayId) return;
      if (!current.current || next.revision >= current.current.revision) current.current = next;
    };
    try {
      const result = await miniCast.editAnnotationSelection(id, edit);
      // Always feed the shared replica, even if the drawing tool was switched meanwhile.
      if (result.update) adopt(await onDocumentUpdate(result.update));
      if (isCurrent() && !result.accepted) setNotice(annotationFailureMessage(result.reason));
    } catch {
      if (isCurrent()) setNotice("편집 결과를 확인하지 못했습니다. 판서 상태를 다시 불러옵니다.");
      try {
        const snapshot = await miniCast.getAnnotationDocument();
        adopt(await onDocumentUpdate({ kind: "snapshot", document: snapshot }));
      } catch {
        if (isCurrent()) setNotice("판서 연결을 확인해 주세요. 확인되지 않은 편집을 다시 적용하지 않았습니다.");
      }
    } finally {
      miniCast.endAnnotationGesture(id);
      if (isCurrent() && pending.current === transaction) {
        pending.current = null;
        const present = new Set(current.current?.elements.map(element => element.id) ?? []);
        setSelection(selected.current.filter(key => present.has(key)));
        setBusy(false);
        requestPaint();
      }
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const source = current.current;
    if (!source || source.displayId !== displayId || pending.current || drag.current ||
        !event.isPrimary || event.button !== 0 || typeof miniCast === "undefined") return;
    event.preventDefault();
    setNotice(null);
    const point = pointerPosition(event);
    const hit = hitTestAnnotationSelection(source.elements, point);
    const ids = selectionAfterClick(selected.current, hit, event.shiftKey);
    setSelection(ids);
    requestPaint();
    if (event.shiftKey || hit === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const id = crypto.randomUUID();
    drag.current = { id, pointerId: event.pointerId, start: point, source, ids,
      dx: 0, dy: 0, preview: source.elements };
    event.currentTarget.dataset.activeGesture = "true";
    miniCast.beginAnnotationGesture(id);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const point = pointerPosition(event);
    const dx = point.x - active.start.x;
    const dy = point.y - active.start.y;
    if (dx === active.dx && dy === active.dy) return;
    try {
      active.preview = translateSelectionElements(active.source.elements, new Set(active.ids), dx, dy);
      active.dx = dx;
      active.dy = dy;
      requestPaint();
    } catch {
      cancelDrag();
      setNotice("이동 가능한 좌표 범위를 벗어나 이동을 취소했습니다.");
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    handlePointerMove(event);
    const active = detachPointer();
    if (!active) return;
    if (Math.hypot(active.dx, active.dy) < 2) {
      miniCast.endAnnotationGesture(active.id);
      requestPaint();
      return;
    }
    void submit(active.id, { kind: "move", revision: active.source.revision,
      ids: active.ids, dx: active.dx, dy: active.dy }, active.preview);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (drag.current?.pointerId === event.pointerId) cancelDrag();
  }

  function deleteSelected() {
    const source = current.current;
    if (!source || pending.current || drag.current || !selected.current.length) return;
    const ids = [...selected.current];
    const removed = new Set(ids);
    const id = crypto.randomUUID();
    setNotice(null);
    miniCast.beginAnnotationGesture(id);
    void submit(id, { kind: "delete", revision: source.revision, ids },
      source.elements.filter(element => !removed.has(element.id)));
  }

  return (
    <>
      <canvas ref={committedCanvas} className="pointer-events-none fixed inset-0 size-full" style={{ zIndex: 1 }} aria-hidden="true" />
      <canvas ref={inputCanvas} className="fixed inset-0 size-full"
        data-annotation-selection-count={count} data-annotation-selection-busy={busy}
        style={{ zIndex: 2, touchAction: "none", pointerEvents: "auto", cursor: busy ? "progress" : "default" }}
        onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel} onLostPointerCapture={handlePointerCancel} aria-label="판서 객체 선택 및 이동" />
      <div className="pointer-events-auto fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white"
        style={{ zIndex: 10 }} role="toolbar" aria-label="판서 선택 도구">
        <span role="status">{busy ? "편집 반영 중" : count ? `${count}개 선택됨` : "객체 클릭 · Shift로 추가 선택"}</span>
        <button type="button" data-selection-delete="" disabled={busy || !count}
          className="rounded px-2 py-1 hover:bg-slate-700 disabled:opacity-40" onClick={deleteSelected}>선택 삭제</button>
        <button type="button" data-selection-clear="" disabled={busy || !count}
          className="rounded px-2 py-1 hover:bg-slate-700 disabled:opacity-40"
          onClick={() => { cancelDrag(); setSelection([]); requestPaint(); }}>선택 해제</button>
      </div>
      {notice && <div role="alert" data-annotation-notice="" className="pointer-events-none fixed top-4 left-4 rounded bg-slate-900 p-3 text-sm text-white" style={{ zIndex: 11 }}>{notice}</div>}
    </>
  );
}

export default memo(AnnotationSelectionSurface);
