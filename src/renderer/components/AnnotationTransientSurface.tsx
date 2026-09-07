import { memo, useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { drawAnnotationElement } from "@/annotation/canvas-renderer";
import type { AnnotationPoint } from "@/annotation/history";
import { TransientInk } from "@/annotation/transient-ink";
import type { TransientAnnotationTool } from "@/shared/contract";

interface Props {
  tool: TransientAnnotationTool;
  color: string;
  width: number;
}
interface Gesture { id: string; pointerId: number }

/** A disposable input/paint layer over the read-only permanent document. */
function AnnotationTransientSurface({ tool, color, width }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ink = useRef(new TransientInk());
  const active = useRef<Gesture | null>(null);
  const cursor = useRef<AnnotationPoint | null>(null);
  const frame = useRef<number | null>(null);
  const wakeTimer = useRef<number | null>(null);
  const alive = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  const paint = useCallback(function draw(): void {
    frame.current = null;
    if (wakeTimer.current !== null) {
      window.clearTimeout(wakeTimer.current);
      wakeTimer.current = null;
    }
    const surface = canvas.current;
    if (!alive.current || !surface) return;
    const context = surface.getContext("2d");
    if (!context) return;
    const now = performance.now();
    const traces = ink.current.frame(now);
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, surface.width, surface.height);
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (tool === "laser") {
        const point = cursor.current;
        if (point) {
          for (const [radius, alpha, fill] of [[14, 0.18, "#FF244C"], [8, 1, "#FF244C"], [2.5, 1, "#FFFFFF"]] as const) {
            context.globalAlpha = alpha;
            context.fillStyle = fill;
            context.beginPath();
            context.arc(point.x, point.y, radius, 0, 2 * Math.PI);
            context.fill();
          }
        }
      } else {
        for (const trace of traces) drawAnnotationElement(context, { ...trace, id: "transient", tool: "pen" });
      }
    } finally { context.restore(); }
    surface.dataset.transientPoints = String(ink.current.pointCount);
    surface.dataset.transientStrokes = String(ink.current.strokeCount);
    surface.dataset.transientAnimating = String(ink.current.animating);
    const delay = ink.current.nextAnimationDelay(now);
    if (delay === 0) {
      frame.current = requestAnimationFrame(draw);
    } else if (delay !== null) {
      wakeTimer.current = window.setTimeout(() => {
        wakeTimer.current = null;
        if (alive.current && frame.current === null)
          frame.current = requestAnimationFrame(draw);
      }, delay);
    }
  }, [tool]);

  const requestPaint = useCallback(() => {
    if (!alive.current) return;
    if (wakeTimer.current !== null) {
      window.clearTimeout(wakeTimer.current);
      wakeTimer.current = null;
    }
    if (frame.current === null) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  const detach = useCallback(() => {
    const gesture = active.current;
    active.current = null;
    const surface = canvas.current;
    if (surface) delete surface.dataset.activeGesture;
    if (gesture) {
      if (surface?.hasPointerCapture(gesture.pointerId)) surface.releasePointerCapture(gesture.pointerId);
      if (typeof miniCast !== "undefined") miniCast.endAnnotationGesture(gesture.id);
    }
    return gesture;
  }, []);

  const cancel = useCallback(() => {
    detach();
    ink.current.cancel();
    requestPaint();
  }, [detach, requestPaint]);

  const clear = useCallback(() => {
    detach();
    ink.current.clear();
    cursor.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (wakeTimer.current !== null) window.clearTimeout(wakeTimer.current);
    wakeTimer.current = null;
    requestPaint();
  }, [detach, requestPaint]);

  useLayoutEffect(() => {
    alive.current = true;
    const surface = canvas.current!;
    const model = ink.current;
    let viewport = "";
    const resize = () => {
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(surface.clientWidth * ratio));
      const h = Math.max(1, Math.round(surface.clientHeight * ratio));
      const nextViewport = `${surface.clientWidth}:${surface.clientHeight}:${ratio}`;
      // CSS size and DPI can change while the physical backing-store size stays equal.
      if (viewport === nextViewport) return;
      viewport = nextViewport;
      clear();
      surface.width = w;
      surface.height = h;
      requestPaint();
    };
    const hidden = () => { if (window.document.hidden) clear(); };
    const observer = new ResizeObserver(resize);
    observer.observe(surface);
    window.addEventListener("resize", resize);
    window.document.addEventListener("visibilitychange", hidden);
    const stops = typeof miniCast === "undefined" ? [] : [
      miniCast.onAnnotationGestureCancel(id => { if (active.current?.id === id) cancel(); }),
      miniCast.onAnnotationTransientClear(clear),
      miniCast.onMouseMove(point => {
        if (!point) {
          const visibleCursor = cursor.current !== null;
          cursor.current = null;
          if (active.current) cancel();
          else if (visibleCursor && tool === "laser") requestPaint();
          return;
        }
        if (tool === "laser") {
          const previous = cursor.current;
          cursor.current = point;
          if (!previous || previous.x !== point.x || previous.y !== point.y) requestPaint();
        }
      }),
    ];
    resize();
    requestPaint();
    return () => {
      alive.current = false;
      detach();
      model.clear();
      cursor.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      if (wakeTimer.current !== null) window.clearTimeout(wakeTimer.current);
      wakeTimer.current = null;
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.document.removeEventListener("visibilitychange", hidden);
      stops.forEach(stop => stop());
    };
  }, [cancel, clear, detach, requestPaint, tool]);

  function points(event: ReactPointerEvent<HTMLCanvasElement>): AnnotationPoint[] {
    const bounds = event.currentTarget.getBoundingClientRect();
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    return (samples.length ? samples : [event.nativeEvent]).map(sample => ({
      x: Math.min(bounds.width, Math.max(0, sample.clientX - bounds.left)),
      y: Math.min(bounds.height, Math.max(0, sample.clientY - bounds.top)),
    }));
  }

  function finish() {
    if (!detach()) return;
    ink.current.finish(performance.now());
    requestPaint();
  }

  function down(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (active.current || !event.isPrimary || event.button !== 0 || typeof miniCast === "undefined") return;
    event.preventDefault();
    setNotice(null);
    const point = points(event)[0];
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
      if (tool === "fading-ink") ink.current.begin(point, color, width, performance.now());
      const gesture = { id: crypto.randomUUID(), pointerId: event.pointerId };
      active.current = gesture;
      event.currentTarget.dataset.activeGesture = tool;
      cursor.current = point;
      miniCast.beginAnnotationGesture(gesture.id);
      requestPaint();
    } catch {
      cancel();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      setNotice("임시 표시를 시작하지 못했습니다. 다시 시도해 주세요.");
    }
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!event.isPrimary || (active.current && active.current.pointerId !== event.pointerId)) return;
    const samples = points(event);
    cursor.current = samples[samples.length - 1];
    if (active.current && tool === "fading-ink") {
      for (const point of samples) {
        if (!ink.current.append(point, performance.now())) {
          finish();
          setNotice("임시 획의 길이 한도에 도달했습니다. 펜을 뗀 뒤 새 획을 시작해 주세요.");
          break;
        }
      }
    }
    requestPaint();
  }

  function up(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (active.current?.pointerId !== event.pointerId) return;
    move(event);
    finish();
  }
  function lost(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (active.current?.pointerId === event.pointerId) cancel();
  }

  return <>
    <canvas ref={canvas} data-annotation-transient={tool} className="fixed inset-0 size-full"
      style={{ zIndex: 3, touchAction: "none", pointerEvents: "auto", cursor: tool === "laser" ? "none" : "crosshair" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={lost} onLostPointerCapture={lost}
      onPointerLeave={() => { cursor.current = null; cancel(); }}
      aria-label={tool === "laser" ? "임시 레이저 포인터" : "자동으로 사라지는 잉크"} />
    {notice && <div role="alert" className="pointer-events-none fixed bottom-4 left-4 rounded bg-slate-900 p-3 text-sm text-white" style={{ zIndex: 5 }}>{notice}</div>}
  </>;
}
export default memo(AnnotationTransientSurface);
