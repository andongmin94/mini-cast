/** Presentation backgrounds are session UI, not ink, document history or file data. */
export const ANNOTATION_BOARD_MODES = ["transparent", "white", "black"] as const;
export type AnnotationBoardMode = typeof ANNOTATION_BOARD_MODES[number];
export interface AnnotationBoardRequest { displayId: number; mode: AnnotationBoardMode }
export interface AnnotationBoardSnapshot {
  readonly revision: number;
  readonly displays: readonly Readonly<AnnotationBoardRequest>[];
}
export type AnnotationBoardResult =
  | { accepted: true; changed: boolean; state: AnnotationBoardSnapshot }
  | { accepted: false; reason: "invalid-request" | "unavailable" | "busy" };

export function isAnnotationBoardMode(value: unknown): value is AnnotationBoardMode {
  return value === "transparent" || value === "white" || value === "black";
}

/** No CSS, arbitrary colors, document data or paths cross the command boundary. */
export function readAnnotationBoardRequest(value: unknown): AnnotationBoardRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (Object.keys(request).length !== 2 || !Object.prototype.hasOwnProperty.call(request, "displayId") ||
      !Object.prototype.hasOwnProperty.call(request, "mode") || !Number.isSafeInteger(request.displayId) ||
      !isAnnotationBoardMode(request.mode)) return null;
  return { displayId: request.displayId as number, mode: request.mode };
}

/** Always expose the desktop in pass-through mode; retain the selected background for re-entry. */
export function annotationBoardBackground(mode: AnnotationBoardMode, interactive: boolean): string {
  if (!interactive) return "transparent";
  if (mode === "white") return "#FFFFFF";
  if (mode === "black") return "#000000";
  // Keep blank layered-window areas hit-testable on Windows without changing ink pixels.
  return "rgba(0, 0, 0, 0.004)";
}

/** An initial invoke can resolve after a newer pushed state. Never roll it back. */
export function newerAnnotationBoards(current: AnnotationBoardSnapshot | null, next: AnnotationBoardSnapshot) {
  return !current || next.revision > current.revision ? next : current;
}

export class AnnotationBoards {
  private modes = new Map<number, AnnotationBoardMode>();
  private revision = 0;
  private cached: AnnotationBoardSnapshot | null = null;

  get snapshot(): AnnotationBoardSnapshot {
    if (!this.cached) this.cached = Object.freeze({
      revision: this.revision,
      displays: Object.freeze([...this.modes].sort(([a], [b]) => a - b)
        .map(([displayId, mode]) => Object.freeze({ displayId, mode }))),
    });
    return this.cached;
  }

  has(displayId: number) { return this.modes.has(displayId); }

  /** Call only after a display swap succeeds. Disconnected screens release their presentation state. */
  retainDisplays(displayIds: Iterable<number>): boolean {
    const ids = [...displayIds];
    if (!ids.every(Number.isSafeInteger) || new Set(ids).size !== ids.length)
      throw new Error("Invalid connected board displays");
    if (ids.length === this.modes.size && ids.every(id => this.modes.has(id))) return false;
    this.modes = new Map(ids.map(id => [id, this.modes.get(id) ?? "transparent"]));
    this.touch();
    return true;
  }

  set(displayId: number, mode: AnnotationBoardMode): boolean {
    if (!Number.isSafeInteger(displayId) || !isAnnotationBoardMode(mode) || !this.modes.has(displayId))
      throw new Error("Invalid annotation board selection");
    if (this.modes.get(displayId) === mode) return false;
    this.modes.set(displayId, mode);
    this.touch();
    return true;
  }

  private touch() { this.revision += 1; this.cached = null; }
}
