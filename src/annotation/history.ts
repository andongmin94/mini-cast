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

interface IndexedStroke {
  stroke: AnnotationStroke;
  index: number;
}

interface AddHistoryEntry {
  kind: "add";
  stroke: AnnotationStroke;
  index: number;
}

interface RemoveHistoryEntry {
  kind: "remove";
  strokes: readonly IndexedStroke[];
}

type HistoryEntry = AddHistoryEntry | RemoveHistoryEntry;

export class AnnotationHistory {
  private strokes: AnnotationStroke[] = [];
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  getSnapshot(): readonly AnnotationStroke[] {
    return [...this.strokes];
  }

  addStroke(stroke: AnnotationStroke) {
    if (this.strokes.some((item) => item.id === stroke.id)) {
      throw new Error(`Duplicate annotation stroke id: ${stroke.id}`);
    }

    const entry: AddHistoryEntry = {
      kind: "add",
      stroke,
      index: this.strokes.length,
    };
    this.apply(entry);
    this.commit(entry);
  }

  removeStrokes(ids: Iterable<string>) {
    const idSet = new Set(ids);
    if (!idSet.size) return false;

    const removed = this.strokes
      .map((stroke, index) => ({ stroke, index }))
      .filter(({ stroke }) => idSet.has(stroke.id));
    if (!removed.length) return false;

    const entry: RemoveHistoryEntry = { kind: "remove", strokes: removed };
    this.apply(entry);
    this.commit(entry);
    return true;
  }

  clear() {
    return this.removeStrokes(this.strokes.map((stroke) => stroke.id));
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;

    this.revert(entry);
    this.redoStack.push(entry);
    return true;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;

    this.apply(entry);
    this.undoStack.push(entry);
    return true;
  }

  private commit(entry: HistoryEntry) {
    this.undoStack.push(entry);
    this.redoStack = [];
  }

  private apply(entry: HistoryEntry) {
    if (entry.kind === "add") {
      this.strokes.splice(
        Math.min(entry.index, this.strokes.length),
        0,
        entry.stroke,
      );
      return;
    }

    const removedIds = new Set(entry.strokes.map(({ stroke }) => stroke.id));
    this.strokes = this.strokes.filter(
      (stroke) => !removedIds.has(stroke.id),
    );
  }

  private revert(entry: HistoryEntry) {
    if (entry.kind === "add") {
      this.strokes = this.strokes.filter(
        (stroke) => stroke.id !== entry.stroke.id,
      );
      return;
    }

    const ordered = [...entry.strokes].sort((left, right) => {
      return left.index - right.index;
    });
    ordered.forEach(({ stroke, index }) => {
      this.strokes.splice(Math.min(index, this.strokes.length), 0, stroke);
    });
  }
}
