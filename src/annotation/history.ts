export interface AnnotationPoint {
  x: number;
  y: number;
}

export type StrokeTool = "pen" | "highlighter";

export interface AnnotationStroke {
  id: string;
  tool: StrokeTool;
  points: readonly AnnotationPoint[];
  color: string;
  width: number;
  opacity: number;
}

export interface AnnotationViewport {
  width: number;
  height: number;
}

export interface AnnotationDocumentSnapshot {
  displayId: number;
  revision: number;
  viewport: AnnotationViewport | null;
  strokes: readonly AnnotationStroke[];
}

export interface AnnotationMutationResult {
  accepted: boolean;
  document: AnnotationDocumentSnapshot | null;
}

interface IndexedStroke {
  stroke: AnnotationStroke;
  index: number;
}

interface AddHistoryEntry {
  kind: "add";
  displayId: number;
  stroke: AnnotationStroke;
  index: number;
}

interface RemoveHistoryEntry {
  kind: "remove";
  displayId: number;
  strokes: readonly IndexedStroke[];
}

type HistoryEntry = AddHistoryEntry | RemoveHistoryEntry;

type UnknownRecord = Record<string, unknown>;

interface DocumentState {
  viewport: AnnotationViewport | null;
  strokes: AnnotationStroke[];
  strokeIds: Set<string>;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinitePoint(value: unknown): value is AnnotationPoint {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

function clonePoint(point: AnnotationPoint): AnnotationPoint {
  return { x: point.x, y: point.y };
}

export function cloneAnnotationStroke(stroke: AnnotationStroke): AnnotationStroke {
  return {
    id: stroke.id,
    tool: stroke.tool,
    points: stroke.points.map(clonePoint),
    color: stroke.color,
    width: stroke.width,
    opacity: stroke.opacity,
  };
}

function scaleStroke(
  stroke: AnnotationStroke,
  scaleX: number,
  scaleY: number,
): AnnotationStroke {
  const widthScale = Math.sqrt(Math.abs(scaleX * scaleY));
  return {
    ...cloneAnnotationStroke(stroke),
    points: stroke.points.map((point) => ({
      x: point.x * scaleX,
      y: point.y * scaleY,
    })),
    width: Math.min(128, Math.max(0.5, stroke.width * widthScale)),
  };
}

function cloneHistoryEntry(entry: HistoryEntry): HistoryEntry {
  if (entry.kind === "add") {
    return { ...entry, stroke: cloneAnnotationStroke(entry.stroke) };
  }
  return {
    ...entry,
    strokes: entry.strokes.map(({ stroke, index }) => ({
      stroke: cloneAnnotationStroke(stroke),
      index,
    })),
  };
}

function scaleHistoryEntry(
  entry: HistoryEntry,
  displayId: number,
  scaleX: number,
  scaleY: number,
): HistoryEntry {
  if (entry.displayId !== displayId) return entry;
  if (entry.kind === "add") {
    return { ...entry, stroke: scaleStroke(entry.stroke, scaleX, scaleY) };
  }
  return {
    ...entry,
    strokes: entry.strokes.map(({ stroke, index }) => ({
      stroke: scaleStroke(stroke, scaleX, scaleY),
      index,
    })),
  };
}

function validViewportDimension(value: number) {
  return Number.isFinite(value) && value > 0 && value <= 100_000;
}

export function isAnnotationStroke(value: unknown): value is AnnotationStroke {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    value.id.length < 1 ||
    value.id.length > 128
  ) {
    return false;
  }
  if (value.tool !== "pen" && value.tool !== "highlighter") return false;
  if (
    !Array.isArray(value.points) ||
    value.points.length < 1 ||
    value.points.length > 200_000
  ) {
    return false;
  }
  if (!value.points.every(isFinitePoint)) return false;
  if (
    typeof value.color !== "string" ||
    value.color.length < 1 ||
    value.color.length > 128
  ) {
    return false;
  }
  if (
    typeof value.width !== "number" ||
    !Number.isFinite(value.width) ||
    value.width < 0.5 ||
    value.width > 128
  ) {
    return false;
  }
  return (
    typeof value.opacity === "number" &&
    Number.isFinite(value.opacity) &&
    value.opacity >= 0 &&
    value.opacity <= 1
  );
}

export function readAnnotationStrokeIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 10_000) return null;
  if (
    !value.every(
      (item) =>
        typeof item === "string" && item.length > 0 && item.length <= 128,
    )
  ) {
    return null;
  }
  return [...new Set(value)];
}

export class AnnotationHistory {
  private documents = new Map<number, DocumentState>();
  private revisions = new Map<number, number>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  clone() {
    const copy = new AnnotationHistory();
    copy.restoreFrom(this);
    return copy;
  }

  restoreFrom(source: AnnotationHistory) {
    this.documents = new Map(
      [...source.documents].map(([displayId, document]) => [
        displayId,
        {
          viewport: document.viewport ? { ...document.viewport } : null,
          strokes: document.strokes.map(cloneAnnotationStroke),
          strokeIds: new Set(document.strokeIds),
        },
      ]),
    );
    this.revisions = new Map(source.revisions);
    this.undoStack = source.undoStack.map(cloneHistoryEntry);
    this.redoStack = source.redoStack.map(cloneHistoryEntry);
  }

  getSnapshot(displayId: number): AnnotationDocumentSnapshot {
    const document = this.document(displayId);
    return {
      displayId,
      revision: this.revisions.get(displayId) ?? 0,
      viewport: document.viewport ? { ...document.viewport } : null,
      strokes: document.strokes.map(cloneAnnotationStroke),
    };
  }

  setDisplayViewport(displayId: number, width: number, height: number) {
    if (!validViewportDimension(width) || !validViewportDimension(height)) {
      throw new Error(`Invalid annotation viewport: ${width}x${height}`);
    }

    const document = this.document(displayId);
    const previous = document.viewport;
    if (!previous) {
      document.viewport = { width, height };
      this.touch(displayId);
      return true;
    }
    if (previous.width === width && previous.height === height) return false;

    const scaleX = width / previous.width;
    const scaleY = height / previous.height;
    document.strokes = document.strokes.map((stroke) =>
      scaleStroke(stroke, scaleX, scaleY),
    );
    document.viewport = { width, height };
    this.undoStack = this.undoStack.map((entry) =>
      scaleHistoryEntry(entry, displayId, scaleX, scaleY),
    );
    this.redoStack = this.redoStack.map((entry) =>
      scaleHistoryEntry(entry, displayId, scaleX, scaleY),
    );
    this.touch(displayId);
    return true;
  }

  addStroke(displayId: number, stroke: AnnotationStroke) {
    const document = this.document(displayId);
    if (document.strokeIds.has(stroke.id)) {
      throw new Error(`Duplicate annotation stroke id: ${stroke.id}`);
    }

    const stored = cloneAnnotationStroke(stroke);
    const entry: AddHistoryEntry = {
      kind: "add",
      displayId,
      stroke: stored,
      index: document.strokes.length,
    };
    this.apply(entry);
    this.commit(entry);
    return displayId;
  }

  removeStrokes(displayId: number, ids: Iterable<string>) {
    const idSet = new Set(ids);
    if (!idSet.size) return null;

    const removed = this.document(displayId)
      .strokes.map((stroke, index) => ({
        stroke: cloneAnnotationStroke(stroke),
        index,
      }))
      .filter(({ stroke }) => idSet.has(stroke.id));
    if (!removed.length) return null;

    const entry: RemoveHistoryEntry = {
      kind: "remove",
      displayId,
      strokes: removed,
    };
    this.apply(entry);
    this.commit(entry);
    return displayId;
  }

  clearDisplay(displayId: number) {
    return this.removeStrokes(
      displayId,
      this.document(displayId).strokes.map((stroke) => stroke.id),
    );
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    this.revert(entry);
    this.redoStack.push(entry);
    return entry.displayId;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;

    this.apply(entry);
    this.undoStack.push(entry);
    return entry.displayId;
  }

  private document(displayId: number) {
    const existing = this.documents.get(displayId);
    if (existing) return existing;

    const created: DocumentState = {
      viewport: null,
      strokes: [],
      strokeIds: new Set(),
    };
    this.documents.set(displayId, created);
    return created;
  }

  private commit(entry: HistoryEntry) {
    this.undoStack.push(entry);
    this.redoStack = [];
  }

  private touch(displayId: number) {
    this.revisions.set(displayId, (this.revisions.get(displayId) ?? 0) + 1);
  }

  private apply(entry: HistoryEntry) {
    const document = this.document(entry.displayId);
    if (entry.kind === "add") {
      document.strokes.splice(
        Math.min(entry.index, document.strokes.length),
        0,
        cloneAnnotationStroke(entry.stroke),
      );
      document.strokeIds.add(entry.stroke.id);
      this.touch(entry.displayId);
      return;
    }

    const removedIds = new Set(entry.strokes.map(({ stroke }) => stroke.id));
    document.strokes = document.strokes.filter(
      (stroke) => !removedIds.has(stroke.id),
    );
    removedIds.forEach((id) => document.strokeIds.delete(id));
    this.touch(entry.displayId);
  }

  private revert(entry: HistoryEntry) {
    const document = this.document(entry.displayId);
    if (entry.kind === "add") {
      document.strokes = document.strokes.filter(
        (stroke) => stroke.id !== entry.stroke.id,
      );
      document.strokeIds.delete(entry.stroke.id);
      this.touch(entry.displayId);
      return;
    }

    const ordered = [...entry.strokes].sort((left, right) => {
      return left.index - right.index;
    });
    ordered.forEach(({ stroke, index }) => {
      document.strokes.splice(
        Math.min(index, document.strokes.length),
        0,
        cloneAnnotationStroke(stroke),
      );
      document.strokeIds.add(stroke.id);
    });
    this.touch(entry.displayId);
  }
}
