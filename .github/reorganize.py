"""Prepare the reviewed 0.11.0 increment; the opt-in job commits only after all gates.
No product mutation is published until native input, packages and diagnostics pass.
The existing job removes this preparation file from the final product commit.
"""
from pathlib import Path
import json
import subprocess

BASE = '321797da92e72974a3f5dbf7e38d3e014be6267c'
subprocess.run(['git', 'fetch', '--depth=1', 'origin', BASE], check=True)
subprocess.run(['git', 'diff', '--exit-code', BASE, 'HEAD', '--', '.', ':!.github/reorganize.py'], check=True)

def source(path):
    return subprocess.check_output(['git', 'show', BASE + ':' + path]).decode('utf-8')

def write(path, value):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(value, encoding='utf-8', newline='\n')

package = json.loads(source('package.json'))
guard = dict(package)
guard['scripts'] = dict(package['scripts'], check='node -e "throw new Error(\'Transient-tool preparation did not complete\')"')
write('package.json', json.dumps(guard, ensure_ascii=False, indent=2) + '\n')
files = {}

def replace(path, old, new, count=1):
    value = files.get(path, source(path))
    actual = value.count(old)
    if actual != count:
        raise RuntimeError(f'{path}: expected {count} targets, found {actual}: {old[:100]!r}')
    files[path] = value.replace(old, new)

files['src/annotation/transient-ink.ts'] = r'''import type { AnnotationPoint } from "./history.js";

export const TRANSIENT_HOLD_MS = 2000;
export const TRANSIENT_FADE_MS = 700;
export const MAX_TRANSIENT_STROKES = 32;
export const MAX_TRANSIENT_POINTS_PER_STROKE = 4096;
export const MAX_TRANSIENT_POINTS = 16384;

interface Trace {
  readonly color: string;
  readonly width: number;
  readonly points: AnnotationPoint[];
  finishedAt: number | null;
}
export interface TransientInkFrame {
  readonly color: string;
  readonly width: number;
  readonly points: readonly AnnotationPoint[];
  readonly opacity: number;
}

function validTime(now: number) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError("Invalid transient clock");
}
function copyPoint(point: AnnotationPoint): AnnotationPoint {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      Math.abs(point.x) > 1_000_000 || Math.abs(point.y) > 1_000_000)
    throw new RangeError("Invalid transient point");
  return { x: point.x, y: point.y };
}
export function transientInkOpacity(finishedAt: number | null, now: number) {
  validTime(now);
  if (finishedAt === null) return 1;
  validTime(finishedAt);
  return Math.max(0, Math.min(1, 1 - (now - finishedAt - TRANSIENT_HOLD_MS) / TRANSIENT_FADE_MS));
}

/** Renderer-local disposable ink. This model has no document, revision or Undo API. */
export class TransientInk {
  private completed: Trace[] = [];
  private active: Trace | null = null;

  get pointCount() {
    return (this.active?.points.length ?? 0) + this.completed.reduce((sum, trace) => sum + trace.points.length, 0);
  }
  get strokeCount() { return this.completed.length + (this.active ? 1 : 0); }
  get animating() { return this.completed.length > 0; }
  get drawing() { return this.active !== null; }

  prune(now: number) {
    validTime(now);
    this.completed = this.completed.filter(trace => transientInkOpacity(trace.finishedAt, now) > 0);
  }

  begin(point: AnnotationPoint, color: string, width: number, now: number) {
    validTime(now);
    const copied = copyPoint(point);
    if (this.active) throw new Error("A transient gesture is already active");
    if (!/^#[\da-f]{6}$/i.test(color) || !Number.isFinite(width) || width < 0.5 || width > 128)
      throw new RangeError("Invalid transient style");
    this.prune(now);
    while (this.completed.length >= MAX_TRANSIENT_STROKES || this.pointCount >= MAX_TRANSIENT_POINTS)
      this.completed.shift();
    this.active = { color, width, points: [copied], finishedAt: null };
  }

  /** False is an explicit length limit; callers finish and release capture instead of silently dropping input. */
  append(point: AnnotationPoint, now: number): boolean {
    validTime(now);
    const copied = copyPoint(point);
    if (!this.active) return false;
    this.prune(now);
    const last = this.active.points[this.active.points.length - 1];
    if ((last.x - copied.x) ** 2 + (last.y - copied.y) ** 2 < 0.75 ** 2) return true;
    if (this.active.points.length >= MAX_TRANSIENT_POINTS_PER_STROKE) return false;
    while (this.completed.length && this.pointCount >= MAX_TRANSIENT_POINTS) this.completed.shift();
    if (this.pointCount >= MAX_TRANSIENT_POINTS) return false;
    this.active.points.push(copied);
    return true;
  }

  finish(now: number) {
    validTime(now);
    if (!this.active) return false;
    this.prune(now);
    this.active.finishedAt = now;
    this.completed.push(this.active);
    this.active = null;
    return true;
  }

  cancel() { this.active = null; }
  clear() { this.active = null; this.completed = []; }

  frame(now: number): readonly TransientInkFrame[] {
    this.prune(now);
    const traces = this.active ? [...this.completed, this.active] : this.completed;
    return traces.map(trace => ({ color: trace.color, width: trace.width, points: trace.points,
      opacity: transientInkOpacity(trace.finishedAt, now) }));
  }
}
'''

files['src/renderer/components/AnnotationTransientSurface.tsx'] = r'''import { memo, useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
  const alive = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  const paint = useCallback(function draw(): void {
    frame.current = null;
    const surface = canvas.current;
    if (!alive.current || !surface) return;
    const context = surface.getContext("2d");
    if (!context) return;
    const traces = ink.current.frame(performance.now());
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
    // Static laser/held ink does not keep an idle RAF loop alive.
    if (ink.current.animating) frame.current = requestAnimationFrame(draw);
  }, [tool]);

  const requestPaint = useCallback(() => {
    if (alive.current && frame.current === null) frame.current = requestAnimationFrame(paint);
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
    requestPaint();
  }, [detach, requestPaint]);

  useLayoutEffect(() => {
    alive.current = true;
    const surface = canvas.current!;
    const resize = () => {
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(surface.clientWidth * ratio));
      const h = Math.max(1, Math.round(surface.clientHeight * ratio));
      if (surface.width === w && surface.height === h) return;
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
        if (!point) { cursor.current = null; if (active.current) cancel(); }
        else if (tool === "laser") cursor.current = point;
        if (tool === "laser" || !point) requestPaint();
      }),
    ];
    resize();
    requestPaint();
    return () => {
      alive.current = false;
      detach();
      ink.current.clear();
      cursor.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
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
'''

replace('src/shared/contract.ts', '  "text",\n] as const;', '  "text",\n  "laser",\n  "fading-ink",\n] as const;')
replace('src/shared/contract.ts', 'export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];', '''export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];
export type TransientAnnotationTool = "laser" | "fading-ink";
export function isTransientAnnotationTool(tool: unknown): tool is TransientAnnotationTool {
  return tool === "laser" || tool === "fading-ink";
}''')
replace('src/electron/main.ts', '  isAnnotationTool,\n', '  isAnnotationTool,\n  isTransientAnnotationTool,\n')
replace('src/electron/main.ts', '    canUndo: annotationHistory.canUndo || gestureLeases.size > 0,\n    canRedo: annotationHistory.canRedo,', '''    canUndo: gestureLeases.size > 0 || (!isTransientAnnotationTool(annotationTool) && annotationHistory.canUndo),
    canRedo: !isTransientAnnotationTool(annotationTool) && annotationHistory.canRedo,''')
replace('src/electron/main.ts', '  if (displayRebuildInProgress) return;\n\n  if (command === "undo"', '''  if (displayRebuildInProgress) return;

  if (isTransientAnnotationTool(annotationTool)) {
    // Temporary tools cannot accidentally consume the permanent Undo/Redo history.
    if (command === "redo") return;
    cancelActiveAnnotationGestures();
    if (command === "clear") overlayWindows.forEach(window =>
      sendToWindow(window, "annotation-transient-clear"));
    sendAnnotationState();
    return;
  }

  if (command === "undo"''')
replace('src/electron/main.ts', '      if (displayId === null || displayRebuildInProgress)\n        return annotationMutationResult(displayId, "unavailable");', '      if (displayId === null || displayRebuildInProgress || isTransientAnnotationTool(annotationTool))\n        return annotationMutationResult(displayId, "unavailable");', 2)
replace('src/electron/preload.cts', '  onAnnotationGestureCancel: (listener: Listener) =>', '  onAnnotationTransientClear: (listener: Listener) => on("annotation-transient-clear", listener),\n  onAnnotationGestureCancel: (listener: Listener) =>')
replace('src/shared/electron-api.d.ts', '  onAnnotationGestureCancel(listener:', '  onAnnotationTransientClear(listener: () => void): Unsubscribe;\n  onAnnotationGestureCancel(listener:')
replace('src/renderer/components/Overlay.tsx', 'import AnnotationSurface from "@/renderer/components/AnnotationSurface";', 'import AnnotationSurface from "@/renderer/components/AnnotationSurface";\nimport AnnotationTransientSurface from "./AnnotationTransientSurface";\nimport { isTransientAnnotationTool } from "@/shared/contract";')
replace('src/renderer/components/Overlay.tsx', '        tool={annotationState.tool}\n', '        tool={isTransientAnnotationTool(annotationState.tool) ? "pass-through" : annotationState.tool}\n')
replace('src/renderer/components/Overlay.tsx', '      {syncNotice && (', '''      {displayId !== null && isTransientAnnotationTool(annotationState.tool) && (
        <AnnotationTransientSurface key={`${displayId}:${annotationState.tool}`} tool={annotationState.tool}
          color={settings.annotationPenColor} width={settings.annotationPenWidth} />
      )}

      {syncNotice && (''')
replace('src/renderer/components/AnnotationControls.tsx', '  Highlighter,\n', '  Highlighter,\n  Crosshair,\n  Timer,\n')
replace('src/renderer/components/AnnotationControls.tsx', 'import AnnotationTextComposer from "./AnnotationTextComposer";', 'import AnnotationTextComposer from "./AnnotationTextComposer";\nimport { isTransientAnnotationTool } from "@/shared/contract";')
replace('src/renderer/components/AnnotationControls.tsx', '  { tool: "text", label: "텍스트", shortcut: "입력 후 클릭 배치", Icon: Type },', '''  { tool: "text", label: "텍스트", shortcut: "입력 후 클릭 배치", Icon: Type },
  { tool: "laser", label: "레이저", shortcut: "포인터 이동 · Escape 종료", Icon: Crosshair },
  { tool: "fading-ink", label: "사라지는 잉크", shortcut: "놓은 뒤 2초 유지 · 0.7초 소멸", Icon: Timer },''')
replace('src/renderer/components/AnnotationControls.tsx', '      {tool === "text" && <AnnotationTextComposer', '''      {isTransientAnnotationTool(tool) && <p className="text-muted-foreground rounded bg-muted p-2 text-xs" data-transient-help="">
        {tool === "laser" ? "레이저는 흔적을 남기지 않습니다." : "펜 색상·굵기로 그리며, 펜을 놓은 뒤 2초 후 서서히 사라집니다."}
        {" "}임시 표시 중에는 아래 프로그램 클릭을 차단합니다. Escape로 조작 모드에 복귀합니다.
        {" "}실행취소는 진행 중 입력만 취소하고, 임시 지우기는 모든 화면의 임시 표시만 지웁니다. 기존 판서·Redo는 유지됩니다.
      </p>}
      {tool === "text" && <AnnotationTextComposer''')
replace('src/renderer/components/AnnotationControls.tsx', '          실행취소\n', '          {isTransientAnnotationTool(tool) ? "입력 취소" : "실행취소"}\n')
replace('src/renderer/components/AnnotationControls.tsx', '          화면지우기\n', '          {isTransientAnnotationTool(tool) ? "임시 지우기" : "화면지우기"}\n')

files['tests/unit/annotation/transient-ink.test.mjs'] = r'''import assert from "node:assert/strict";
import test from "node:test";
import { TransientInk, transientInkOpacity, TRANSIENT_HOLD_MS, TRANSIENT_FADE_MS,
  MAX_TRANSIENT_STROKES, MAX_TRANSIENT_POINTS_PER_STROKE, MAX_TRANSIENT_POINTS } from "../../../dist/annotation/transient-ink.js";
import { AnnotationHistory, isAnnotationElement } from "../../../dist/annotation/history.js";
import { isAnnotationTool, isTransientAnnotationTool } from "../../../dist/shared/contract.js";
const point = (x = 0, y = 0) => ({ x, y });
const begin = (ink, now = 0) => ink.begin(point(), "#FF0000", 4, now);

test("temporary tools are valid UI modes but never permanent element types", () => {
  for (const tool of ["laser", "fading-ink"]) {
    assert.equal(isAnnotationTool(tool), true); assert.equal(isTransientAnnotationTool(tool), true);
    assert.equal(isAnnotationElement({id:"t",tool,points:[point()],color:"#FF0000",width:4,opacity:1}), false);
  }
  for (const tool of ["pen", "highlighter", "select", null, {}, "laser-fallback"]) assert.equal(isTransientAnnotationTool(tool), false);
});
test("fading starts at release and uses elapsed time rather than frame count", () => {
  const ink = new TransientInk(); begin(ink);
  assert.equal(ink.frame(100000)[0].opacity, 1);
  ink.finish(100000);
  assert.equal(ink.frame(100000 + TRANSIENT_HOLD_MS)[0].opacity, 1);
  assert.equal(ink.frame(100000 + TRANSIENT_HOLD_MS + TRANSIENT_FADE_MS / 2)[0].opacity, 0.5);
  assert.deepEqual(ink.frame(100000 + TRANSIENT_HOLD_MS + TRANSIENT_FADE_MS), []);
  assert.equal(ink.pointCount, 0); assert.equal(ink.animating, false);
});
test("each completed stroke has its own lifetime and active input remains visible", () => {
  const ink = new TransientInk(); begin(ink); ink.finish(0); begin(ink, 500); ink.finish(500); begin(ink, 600);
  assert.deepEqual(ink.frame(2700).map(x => x.opacity), [5/7, 1]);
  assert.equal(ink.strokeCount, 2); ink.cancel(); assert.equal(ink.strokeCount, 1);
});
test("a suspended animation purges expired data on the next frame", () => {
  const ink = new TransientInk(); begin(ink); ink.finish(10);
  assert.deepEqual(ink.frame(3600000), []); assert.equal(ink.pointCount, 0); assert.equal(ink.strokeCount, 0);
});
test("static active ink does not need a continuous animation loop", () => {
  const ink = new TransientInk(); begin(ink); assert.equal(ink.animating, false);
  ink.finish(10); assert.equal(ink.animating, true); ink.frame(3000); assert.equal(ink.animating, false);
});
test("samples are copied and subpixel duplicates do not inflate the point buffer", () => {
  const ink = new TransientInk(), input = point(10, 20); ink.begin(input,"#123456",8,0); input.x = 99;
  assert.equal(ink.frame(0)[0].points[0].x,10); assert.equal(ink.append(point(10.1,20.1),0),true);
  assert.equal(ink.pointCount,1); ink.append(point(11,20),1); assert.equal(ink.pointCount,2);
  assert.throws(() => begin(ink)); assert.equal(ink.pointCount,2);
});
test("per-stroke limits explicitly stop collection and keep the captured prefix", () => {
  const ink = new TransientInk(); begin(ink);
  for (let i=1;i<MAX_TRANSIENT_POINTS_PER_STROKE;i++) assert.equal(ink.append(point(i,0),0),true);
  assert.equal(ink.append(point(10000,0),0),false); assert.equal(ink.pointCount,MAX_TRANSIENT_POINTS_PER_STROKE);
  assert.equal(ink.finish(1),true); assert.equal(ink.finish(1),false);
});
test("completed transient strokes are bounded and oldest disposable traces expire first", () => {
  const ink = new TransientInk();
  for (let i=0;i<100;i++) { ink.begin(point(i,0),"#FF0000",4,0); ink.finish(0); }
  assert.equal(ink.strokeCount,MAX_TRANSIENT_STROKES); assert.equal(ink.frame(0)[0].points[0].x,68);
});
test("the total point budget is enforced across large overlapping temporary strokes", () => {
  const ink = new TransientInk();
  for (let s=0;s<20;s++) { begin(ink); for(let p=1;p<MAX_TRANSIENT_POINTS_PER_STROKE;p++) ink.append(point(p,s),0); ink.finish(0);
    assert.ok(ink.pointCount<=MAX_TRANSIENT_POINTS); }
  assert.ok(ink.frame(0).every(x=>x.opacity===1)); ink.clear(); assert.equal(ink.pointCount,0);
});
test("cancellation drops only the active gesture, while explicit clear drops all temporary state", () => {
  const ink = new TransientInk(); begin(ink); ink.finish(0); begin(ink,1); ink.cancel();
  assert.equal(ink.strokeCount,1); assert.equal(ink.drawing,false); ink.clear(); ink.clear();
  assert.equal(ink.strokeCount,0); assert.equal(ink.animating,false); assert.equal(ink.append(point(),3),false);
});
test("invalid clocks, coordinates and styles are rejected before collecting input", () => {
  const ink = new TransientInk();
  for (const now of [NaN, Infinity, -1]) assert.throws(()=>begin(ink,now));
  for (const p of [point(NaN),point(Infinity),point(1000001),null]) assert.throws(()=>ink.begin(p,"#FF0000",4,0));
  for (const width of [NaN,Infinity,0,129]) assert.throws(()=>ink.begin(point(),"#FF0000",width,0));
  for (const color of ["url(x)","red","#123","#FFFFFF00"]) assert.throws(()=>ink.begin(point(),color,4,0));
  assert.equal(ink.pointCount,0); assert.equal(transientInkOpacity(100,50),1);
});
test("transient lifecycle cannot mutate a retained permanent document or its Redo", () => {
  const history = new AnnotationHistory();
  history.addElement(1,{id:"saved",tool:"pen",color:"#FF0000",width:4,opacity:1,points:[point()]});
  history.addElement(1,{id:"redo",tool:"pen",color:"#FF0000",width:4,opacity:1,points:[point(10,10)]}); history.undo();
  const before = history.getSnapshot(1); const ink = new TransientInk();
  for (let i=0;i<500;i++) { begin(ink,i); ink.append(point(i+1,20),i); if(i%3) ink.finish(i); else ink.cancel(); ink.frame(i+50); }
  ink.clear(); assert.strictEqual(history.getSnapshot(1),before); assert.equal(history.canRedo,true);
});
'''

files['src/electron/testing/transient-smoke.ts'] = r'''import assert from "node:assert/strict";
import type { AnnotationHistory } from "../../annotation/history.js";
import type { AnnotationCommand, AnnotationState, AnnotationTool } from "../../shared/contract.js";
import { mainWindow, overlayDisplays, overlayWindows } from "../window.js";
import { injectWindowsClick, injectWindowsDrag, injectWindowsMouseButton, injectWindowsMouseMove, injectWindowsShortcut, waitFor } from "./smoke.js";

interface Context {
  history: AnnotationHistory;
  state(): AnnotationState;
  publishDocument(id: number): void;
  activateTool(tool: AnnotationTool): Promise<void>;
  command(command: AnnotationCommand): Promise<void>;
}

/** OS input and Canvas observations; no pointer events are synthesized in the renderer. */
export async function verifyTransientTools(context: Context, displayId: number) {
  const overlay = overlayWindows[overlayDisplays.findIndex(item => item.id === displayId)];
  const controller = mainWindow;
  if (!overlay || !controller) throw new Error("Transient test windows missing");
  const query = (script: string) => overlay.webContents.executeJavaScript(script);
  const history = context.history;
  const state = () => history.getSnapshot(displayId);
  const ready = async () => waitFor(async () => Number(await query(
    `document.querySelector('[data-mini-cast-overlay]')?.dataset.annotationRevision`)) === state().revision, 5000, "permanent document displayed");
  const at = (x: number, y: number) => { const b=overlay.getContentBounds(); return {x:Math.round(b.x+x),y:Math.round(b.y+y)}; };
  const choose = async (tool: AnnotationTool) => {
    await context.activateTool(tool);
    await waitFor(()=>context.state().tool===tool,5000,"temporary tool activated");
    controller.hide();
    if (tool === "laser" || tool === "fading-ink") await waitFor(async()=>Boolean(await query(
      `document.querySelector('[data-annotation-transient="${tool}"]')`)),5000,"temporary surface mounted");
  };
  const sample = async (x: number, y: number) => query(`(() => {
    const c=document.querySelector('[data-annotation-transient]'); if(!c)return null;
    return Array.from(c.getContext('2d').getImageData(Math.round(${x}*c.width/c.clientWidth),Math.round(${y}*c.height/c.clientHeight),1,1).data);
  })()`);
  const noTransientInk = async () => Boolean(await query(`(() => {
    const c=document.querySelector('[data-annotation-transient]'); if(!c)return true;
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    for(let i=3;i<d.length;i+=4)if(d[i])return false; return true;
  })()`));
  const draw = async () => { const a=at(160,220), b=at(260,220); await injectWindowsDrag(a.x,a.y,b.x,b.y); };
  const leaseEnded = async () => waitFor(()=>!context.state().canUndo,5000,"temporary gesture lease ended");

  history.clearDisplay(displayId);
  history.addElement(displayId,{id:"transient-baseline",tool:"pen",points:[{x:100,y:80},{x:300,y:80}],color:"#00A050",width:6,opacity:1});
  history.addElement(displayId,{id:"transient-redo",tool:"pen",points:[{x:100,y:110},{x:300,y:110}],color:"#00A050",width:6,opacity:1});
  history.undo(); context.publishDocument(displayId); await ready();
  const before = state();
  const unchanged = () => { assert.strictEqual(state(),before); assert.equal(history.canRedo,true); };
  await choose("fading-ink");
  assert.equal(context.state().canUndo,false); assert.equal(context.state().canRedo,false);
  await ready();
  await query(`window.__temporaryBaseline = document.querySelector('canvas').getContext('2d').getImageData(0,0,document.querySelector('canvas').width,document.querySelector('canvas').height).data`);
  await draw(); await leaseEnded();
  await waitFor(async()=> (await sample(210,220))?.[3]===255,1500,"temporary ink visible after release");
  await waitFor(async()=> { const alpha=(await sample(210,220))?.[3]; return alpha>0&&alpha<255; },4000,"temporary ink actually fades");
  await waitFor(noTransientInk,3000,"temporary pixels expire completely");
  assert.equal(await query(`document.querySelector('[data-annotation-transient]').dataset.transientPoints`),"0");
  assert.equal(await query(`document.querySelector('[data-annotation-transient]').dataset.transientAnimating`),"false"); unchanged();
  assert.equal(await query(`(() => {const c=document.querySelector('canvas'), d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return d.every((v,i)=>v===window.__temporaryBaseline[i]);})()`),true);

  await draw(); await leaseEnded(); await context.command("clear");
  await waitFor(noTransientInk,2000,"Clear removes temporary ink only"); unchanged();
  await context.command("undo"); await context.command("redo"); unchanged();

  const a=at(160,220), b=at(260,220);
  try {
    await injectWindowsMouseButton(a.x,a.y,true); await injectWindowsMouseMove(b.x,b.y);
    await waitFor(()=>context.state().canUndo,3000,"held temporary lease visible");
    await context.command("undo");
    await waitFor(async()=>!await query(`Boolean(document.querySelector('[data-active-gesture]'))`),3000,"held temporary gesture cancelled");
    await waitFor(noTransientInk,2000,"held Undo discards temporary preview"); unchanged();
  } finally { await injectWindowsMouseButton(b.x,b.y,false); }

  await draw();
  const loaded=new Promise<void>(resolve=>overlay.webContents.once("did-finish-load",()=>resolve()));
  overlay.webContents.reload(); await loaded; await ready();
  await waitFor(async()=>Boolean(await query(`document.querySelector('[data-annotation-transient="fading-ink"]')`)),5000,"temporary surface reloads");
  await waitFor(noTransientInk,2000,"reload discards temporary ink"); unchanged();

  await choose("laser"); const p=at(320,240); await injectWindowsMouseMove(p.x,p.y);
  await waitFor(async()=> { const pixel=await sample(325,240); return pixel?.[0]===255&&pixel?.[3]===255; },3000,"laser red ring tracks OS pointer");
  const q=at(430,300); await injectWindowsMouseMove(q.x,q.y);
  await waitFor(async()=> (await sample(325,240))?.[3]===0 && (await sample(435,300))?.[3]===255,3000,"laser leaves no trail");
  await injectWindowsClick(q.x,q.y); await leaseEnded(); unchanged();

  // Even a valid, leased pen payload must be rejected while a temporary tool owns input.
  const blocked=await query(`(async()=>{
    const id=crypto.randomUUID(); miniCast.beginAnnotationGesture(id);
    try {const added=await miniCast.commitAnnotationElement(id,{id:'forbidden-temp-save',tool:'pen',color:'#FF0000',width:4,opacity:1,points:[{x:20,y:20}]});
      const erased=await miniCast.removeAnnotationElements(id,['transient-baseline']);return !added.accepted&&!erased.accepted;}
    finally {miniCast.endAnnotationGesture(id);}
  })()`); assert.equal(blocked,true); unchanged();

  await choose("fading-ink");
  try {
    await injectWindowsMouseButton(a.x,a.y,true); await injectWindowsMouseMove(b.x,b.y);
    await injectWindowsShortcut("Escape");
    await waitFor(()=>context.state().tool==="pass-through",3000,"Escape restores pass-through");
  } finally { await injectWindowsMouseButton(b.x,b.y,false); }
  await waitFor(async()=>!await query(`Boolean(document.querySelector('[data-annotation-transient]'))`),3000,"temporary layer removed on exit"); unchanged();
  await choose("pen"); assert.equal(context.state().canRedo,true);
  await context.command("redo"); await waitFor(()=>state().elements.some(item=>item.id==="transient-redo"),3000,"permanent Redo remains usable");
  await context.command("undo"); await ready(); assert.deepEqual(state().elements,before.elements);
  return { laser:true, fadingPixels:true, expiry:true, idleStopped:true, historyIsolated:true, clear:true,
    heldUndo:true, heldEscape:true, reload:true, permanentWritesRejected:true, redoPreserved:true };
}
'''
replace('src/electron/testing/interaction-smoke.ts', 'import { framePoint } from "../../annotation/primitive-frame.js";', 'import { framePoint } from "../../annotation/primitive-frame.js";\nimport { verifyTransientTools } from "./transient-smoke.js";')
marker = '    } finally {\n      if (!underlay.isDestroyed()) underlay.destroy();'
replace('src/electron/testing/interaction-smoke.ts', marker, '''      diagnostics.transientTools = await verifyTransientTools({
        history: annotationHistory, state: context.state, publishDocument: context.publishDocument, command: shortcutCommand,
        activateTool: async tool => {
          if (!mainWindow) throw new Error("Missing temporary-tool controller");
          await clickControllerElement(mainWindow, `[data-annotation-tool="${tool}"]`, "temporary tool");
          await waitFor(() => context.state().tool === tool, 5000, "temporary tool state");
        },
      }, primary.id);
    } finally {
      if (!underlay.isDestroyed()) underlay.destroy();''')
replace('scripts/verify-diagnostics.ps1', '  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"', '''  foreach ($name in @('laser','fadingPixels','expiry','idleStopped','historyIsolated','clear','heldUndo','heldEscape','reload','permanentWritesRejected','redoPreserved')) {
    if (-not $result.diagnostics.transientTools.$name) { throw "Missing temporary-tool verification: $name" }
  }
  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"''')
files['scripts/verify-source.ps1'] = source('scripts/verify-source.ps1') + "\nif (-not $payload.diagnostics.transientTools.redoPreserved -or -not $payload.diagnostics.transientTools.expiry) { throw 'Laser/fading-ink lifecycle was not verified.' }\n"

notes = '''\n## 레이저·사라지는 잉크 (0.11.0)\n\n레이저는 포인터를 따라가는 빨간 점이며 클릭·드래그해도 선이나 문서 객체를 남기지 않습니다. 사라지는 잉크는 현재 펜 색상·굵기로 그리며, 각 획은 버튼을 놓은 뒤 2초 동안 유지한 후 0.7초 동안 사라집니다. 누르고 있는 획은 유지됩니다. 두 도구 모두 아래 프로그램의 클릭을 차단하며 Escape로 조작 모드에 복귀합니다. 이번 레이저는 궤적을 남기는 도구가 아닙니다.\n\n임시 표시 모드의 Ctrl+Z는 진행 중 입력만 취소합니다. 완료된 임시 획은 Undo/Redo에 들어가지 않고 Redo는 비활성화됩니다. ‘임시 지우기’는 모든 모니터의 임시 표시만 지우며 기존 판서와 문서 Redo는 보존합니다. 일반 판서 모드로 돌아가면 기존 Undo/Redo를 계속 사용할 수 있습니다.\n\n임시 좌표는 renderer에만 존재하며 IPC 문서·선택·지우개·설정 파일에 넣지 않습니다. 도구 전환·재로딩·화면 크기 변경·숨김 시 임시 표시를 폐기하고, 모니터를 벗어난 진행 중 입력은 취소합니다. 프레임 수가 아니라 단조 시계의 경과 시간으로 소멸시켜 애니메이션 재개 때 만료된 획을 제거합니다. 표시할 애니메이션이 없으면 RAF 반복을 멈춥니다.\n\n한 화면에 최대 32개의 임시 획과 16,384포인트를 유지합니다. 용량이 차면 오래된 완료 임시 획만 먼저 폐기합니다. 한 획은 4,096포인트에서 마무리하고 사용자에게 안내합니다. 영구 문서에는 이 정책을 적용하지 않습니다.\n'''
files['docs/ANNOTATION-TOOLS.md'] = source('docs/ANNOTATION-TOOLS.md').replace('현재 문서 기준은 0.10.0입니다.', '현재 문서 기준은 0.11.0입니다.').replace('레이저, 캡처 및 판서 파일 저장은 아직 지원하지 않습니다.', '캡처 및 판서 파일 저장은 아직 지원하지 않습니다.') + notes
files['docs/CHANGELOG.md'] = source('docs/CHANGELOG.md') + '''\n\n## 0.11.0 — 레이저와 임시 잉크\n\n- 문서 이력과 분리된 레이저 포인터 및 시간 기반 사라지는 잉크를 추가했습니다.\n- 임시 모드의 취소·지우기는 영구 판서와 Redo를 보존하고 영구 문서 쓰기 IPC를 차단합니다.\n- 좌표 버퍼 상한, 소멸 시 정리, 유휴 RAF 중지 및 Windows 실제 입력 검증을 추가했습니다.\n'''
package['version'] = '0.11.0'
files['package.json'] = json.dumps(package, ensure_ascii=False, indent=2) + '\n'
lock = json.loads(source('package-lock.json'))
lock['version'] = '0.11.0'
lock['packages']['']['version'] = '0.11.0'
files['package-lock.json'] = json.dumps(lock, ensure_ascii=False, indent=2) + '\n'
for name, content in files.items():
    if name != 'package.json': write(name, content)
write('package.json', files['package.json'])
subprocess.run(['git','add','package-lock.json'], check=True)
print('TRANSIENT_TOOLS_PREPARATION_COMPLETE version=0.11.0; native lifetime and history-isolation diagnostics are mandatory')
