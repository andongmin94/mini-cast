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

export interface AnnotationDocumentSnapshot {
  displayId: number;
  revision: number;
  strokes: readonly AnnotationStroke[];
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
  private documents = new Map<number, AnnotationStroke[]>();
  private revisions = new Map<number, number>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  getSnapshot(displayId: number): AnnotationDocumentSnapshot {
    return {
      displayId,
      revision: this.revisions.get(displayId) ?? 0,
      strokes: [...this.document(displayId)],
    };
  }

  addStroke(displayId: number, stroke: AnnotationStroke) {
    const document = this.document(displayId);
    if (document.some((item) => item.id === stroke.id)) {
      throw new Error(`Duplicate annotation stroke id: ${stroke.id}`);
    }

    const entry: AddHistoryEntry = {
      kind: "add",
      displayId,
      stroke,
      index: document.length,
    };
    this.apply(entry);
    this.commit(entry);
    return displayId;
  }

  removeStrokes(displayId: number, ids: Iterable<string>) {
    const idSet = new Set(ids);
    if (!idSet.size) return null;

    const removed = this.document(displayId)
      .map((stroke, index) => ({ stroke, index }))
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
      this.document(displayId).map((stroke) => stroke.id),
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

    const created: AnnotationStroke[] = [];
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
      document.splice(Math.min(entry.index, document.length), 0, entry.stroke);
      this.touch(entry.displayId);
      return;
    }

    const removedIds = new Set(entry.strokes.map(({ stroke }) => stroke.id));
    this.documents.set(
      entry.displayId,
      document.filter((stroke) => !removedIds.has(stroke.id)),
    );
    this.touch(entry.displayId);
  }

  private revert(entry: HistoryEntry) {
    if (entry.kind === "add") {
      this.documents.set(
        entry.displayId,
        this.document(entry.displayId).filter(
          (stroke) => stroke.id !== entry.stroke.id,
        ),
      );
      this.touch(entry.displayId);
      return;
    }

    const document = this.document(entry.displayId);
    const ordered = [...entry.strokes].sort((left, right) => {
      return left.index - right.index;
    });
    ordered.forEach(({ stroke, index }) => {
      document.splice(Math.min(index, document.length), 0, stroke);
    });
    this.touch(entry.displayId);
  }
}
