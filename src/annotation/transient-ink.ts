import type { AnnotationPoint } from "./history.js";

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
