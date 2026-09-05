import { frameCorners, validTextFrame } from "./primitive-frame.js";
import { normalizeRotation, rotatePoint } from "./rotation.js";
import { AnnotationError } from "./errors.js";
import { readAnnotationTextDraft, type TextInkBox } from "./text.js";

export interface AnnotationPoint {
  readonly x: number;
  readonly y: number;
}

export type StrokeTool = "pen" | "highlighter";

interface ElementStyle {
  readonly id: string;
  readonly color: string;
  readonly opacity: number;
}

export type ShapeTool = "line" | "arrow" | "rectangle" | "ellipse";
export const SHAPE_TOOLS: readonly ShapeTool[] = ["line", "arrow", "rectangle", "ellipse"];
export function isShapeTool(value: unknown): value is ShapeTool {
  return typeof value === "string" && (SHAPE_TOOLS as readonly string[]).includes(value);
}

export interface StrokeElement extends ElementStyle {
  readonly tool: StrokeTool;
  readonly points: readonly AnnotationPoint[];
  readonly width: number;
}

export interface ShapeElement extends ElementStyle {
  readonly tool: ShapeTool;
  /** Line/arrow: two endpoints. Rectangle/ellipse: origin, x end, y end. */
  readonly points: readonly AnnotationPoint[];
  readonly width: number;
}

export interface TextElement extends ElementStyle {
  readonly tool: "text";
  readonly points: readonly AnnotationPoint[];
  readonly text: string;
  readonly fontSize: number;
  /** Local glyph/layout bounds before viewport scaling. */
  readonly box: TextInkBox;
}

export type InkElement = StrokeElement | ShapeElement;
export type AnnotationElement = InkElement | TextElement;

/** Text storage participates in the existing bounded document/history budget. */
export function annotationElementCost(element: AnnotationElement) {
  return element.points.length + (element.tool === "text" ? element.text.length : 0);
}

export interface AnnotationViewport {
  readonly width: number;
  readonly height: number;
}

export interface AnnotationDocumentSnapshot {
  readonly displayId: number;
  readonly revision: number;
  readonly viewport: AnnotationViewport | null;
  readonly elements: readonly AnnotationElement[];
}

interface IndexedElement {
  stroke: AnnotationElement;
  index: number;
}

interface AddHistoryEntry {
  kind: "add";
  displayId: number;
  stroke: AnnotationElement;
  index: number;
}

interface RemoveHistoryEntry {
  kind: "remove";
  displayId: number;
  elements: readonly IndexedElement[];
}

interface TransformHistoryEntry {
  kind: "transform";
  displayId: number;
  changes: readonly {
    index: number;
    before: AnnotationElement;
    after: AnnotationElement;
  }[];
}

type HistoryEntry = AddHistoryEntry | RemoveHistoryEntry | TransformHistoryEntry;

type UnknownRecord = Record<string, unknown>;

export const MAX_ANNOTATION_COORDINATE = 1_000_000;
export const MAX_ANNOTATION_POINTS_PER_STROKE = 50_000;
export const MAX_ANNOTATION_POINTS_PER_DISPLAY = 1_000_000;
export const MAX_ANNOTATION_ELEMENTS_PER_DISPLAY = 10_000;
export const MAX_ANNOTATION_HISTORY_ENTRIES = 2_000;
export const MAX_ANNOTATION_HISTORY_POINTS = MAX_ANNOTATION_POINTS_PER_DISPLAY;

const HEX_COLOR = /^#[\da-f]{6}$/i;

interface DocumentState {
  viewport: AnnotationViewport | null;
  elements: AnnotationElement[];
  elementIds: Set<string>;
  pointCount: number;
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
    Number.isFinite(value.y) &&
    Math.abs(value.x) <= MAX_ANNOTATION_COORDINATE &&
    Math.abs(value.y) <= MAX_ANNOTATION_COORDINATE
  );
}

/** Copy untrusted input exactly once, then share only deeply immutable geometry. */
function immutableElement(element: AnnotationElement): AnnotationElement {
  const common = {
    id: element.id, color: element.color, opacity: element.opacity,
    points: Object.freeze(element.points.map(({ x, y }) => Object.freeze({ x, y }))),
  };
  if (element.tool === "text") return Object.freeze({
    ...common, tool: "text", text: element.text, fontSize: element.fontSize,
    box: Object.freeze({ minX: element.box.minX, minY: element.box.minY, maxX: element.box.maxX, maxY: element.box.maxY }),
  });
  return Object.freeze({ ...common, tool: element.tool, width: element.width });
}

function scaleElement(element: AnnotationElement, scaleX: number, scaleY: number): AnnotationElement {
  const points = Object.freeze(element.points.map(point => Object.freeze({
    x: point.x * scaleX, y: point.y * scaleY,
  })));
  if (element.tool === "text") return Object.freeze({
    ...element, points,
  });
  const widthScale = Math.sqrt(Math.abs(scaleX * scaleY));
  return Object.freeze({
    ...element, points, width: Math.min(128, Math.max(0.5, element.width * widthScale)),
  });
}

function validResizeTransform(anchor: AnnotationPoint, scaleX: number, scaleY: number) {
  return isFinitePoint(anchor) && Number.isFinite(scaleX) && Number.isFinite(scaleY) && scaleX > 0 && scaleY > 0;
}

/** Same geometry for preview and commit. Bounds/width overflow rejects the edit;
 * it is never silently clamped into a different shape. */
export function resizeAnnotationElement(
  element: AnnotationElement, anchor: AnnotationPoint, scaleX: number, scaleY: number,
): AnnotationElement {
  if (!validResizeTransform(anchor, scaleX, scaleY) || !isAnnotationElement(element))
    throw new AnnotationError("invalid-element");
  if (scaleX === 1 && scaleY === 1) return element;
  const points = element.points.map(point => ({
    x: anchor.x + (point.x - anchor.x) * scaleX,
    y: anchor.y + (point.y - anchor.y) * scaleY,
  }));
  const resized: AnnotationElement = element.tool === "text"
    ? { ...element, points }
    : { ...element, points, width: element.width * Math.sqrt(scaleX * scaleY) };
  if (!isAnnotationElement(resized)) throw new AnnotationError("invalid-element");
  return immutableElement(resized);
}

/** Rotate every control point while retaining text frames, identity and style. */
export function rotateAnnotationElement(element: AnnotationElement, center: AnnotationPoint, radians: number): AnnotationElement {
  if (!isFinitePoint(center) || !isAnnotationElement(element)) throw new AnnotationError("invalid-element");
  const angle = normalizeRotation(radians);
  if (angle === 0) return element;
  const rotated = { ...element, points: element.points.map(point => rotatePoint(point, center, angle)) };
  if (!isAnnotationElement(rotated)) throw new AnnotationError("invalid-element");
  return immutableElement(rotated);
}

/** Translation preserves IDs and styles; invalid coordinates are rejected before publication. */
export function translateAnnotationElement(element: AnnotationElement, dx: number, dy: number): AnnotationElement {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new AnnotationError("invalid-element");
  const points = Object.freeze(element.points.map(point => {
    const x = point.x + dx;
    const y = point.y + dy;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > MAX_ANNOTATION_COORDINATE || Math.abs(y) > MAX_ANNOTATION_COORDINATE)
      throw new AnnotationError("invalid-element");
    return Object.freeze({ x, y });
  }));
  return element.tool === "text"
    ? Object.freeze({ ...element, points, box: Object.isFrozen(element.box) ? element.box : Object.freeze({ ...element.box }) })
    : Object.freeze({ ...element, points });
}

function cloneHistoryEntry(entry: HistoryEntry): HistoryEntry {
  if (entry.kind === "transform") return { ...entry, changes: entry.changes.map(change => ({ ...change })) };
  if (entry.kind === "add") {
    return { ...entry };
  }
  return {
    ...entry,
    elements: entry.elements.map(({ stroke, index }) => ({
      stroke,
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
  if (entry.kind === "transform") return { ...entry, changes: entry.changes.map(change => ({
    index: change.index,
    before: scaleElement(change.before, scaleX, scaleY),
    after: scaleElement(change.after, scaleX, scaleY),
  })) };
  if (entry.kind === "add") {
    return { ...entry, stroke: scaleElement(entry.stroke, scaleX, scaleY) };
  }
  return {
    ...entry,
    elements: entry.elements.map(({ stroke, index }) => ({
      stroke: scaleElement(stroke, scaleX, scaleY),
      index,
    })),
  };
}

function historyEntryPointCount(entry: HistoryEntry) {
  // Account for displaced geometry. Destinations are shared with the current
  // document or a following history entry, rather than copied for each owner.
  if (entry.kind === "transform") return entry.changes.reduce((sum, change) => sum + annotationElementCost(change.before), 0);
  return entry.kind === "add"
    ? annotationElementCost(entry.stroke)
    : entry.elements.reduce(
      (total, { stroke }) => total + annotationElementCost(stroke),
      0,
    );
}

function validViewportDimension(value: number) {
  return Number.isFinite(value) && value > 0 && value <= 100_000;
}

export function isAnnotationElement(value: unknown): value is AnnotationElement {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length < 1 || value.id.length > 128) return false;
  if (!Array.isArray(value.points) || !value.points.length ||
    value.points.length > MAX_ANNOTATION_POINTS_PER_STROKE || !value.points.every(isFinitePoint)) return false;
  if (typeof value.color !== "string" || !HEX_COLOR.test(value.color)) return false;
  if (value.tool === "text") {
    const draft = readAnnotationTextDraft(value);
    if (!draft || draft.text !== value.text || value.points.length !== 3 || value.opacity !== 1 || "scaleX" in value || "scaleY" in value) return false;
    if (!isRecord(value.box)) return false;
    const { minX, minY, maxX, maxY } = value.box;
    if (![minX, minY, maxX, maxY].every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= MAX_ANNOTATION_COORDINATE)) return false;
    return (maxX as number) > (minX as number) && (maxY as number) > (minY as number) &&
      validTextFrame(value.points as AnnotationPoint[], value.box as unknown as TextInkBox, MAX_ANNOTATION_COORDINATE);
  }
  if (value.tool !== "pen" && value.tool !== "highlighter" && !isShapeTool(value.tool)) return false;
  if (isShapeTool(value.tool) && value.points.length !== (value.tool === "rectangle" || value.tool === "ellipse" ? 3 : 2)) return false;
  if ((value.tool === "rectangle" || value.tool === "ellipse") &&
      !frameCorners(value.points as AnnotationPoint[]).every(isFinitePoint)) return false;
  if (typeof value.width !== "number" || !Number.isFinite(value.width) || value.width < 0.5 || value.width > 128) return false;
  return value.opacity === (value.tool === "highlighter" ? 0.35 : 1);
}

export function readAnnotationElementIds(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_ANNOTATION_ELEMENTS_PER_DISPLAY
  ) {
    return null;
  }
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
  private snapshots = new Map<number, AnnotationDocumentSnapshot>();
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
    if (source === this) return;
    this.snapshots.clear();
    this.documents = new Map(
      [...source.documents].map(([displayId, document]) => [
        displayId,
        {
          viewport: document.viewport ? { ...document.viewport } : null,
          elements: document.elements.slice(),
          elementIds: new Set(document.elementIds),
          pointCount: document.pointCount,
        },
      ]),
    );
    this.revisions = new Map(source.revisions);
    this.undoStack = source.undoStack.map(cloneHistoryEntry);
    this.redoStack = source.redoStack.map(cloneHistoryEntry);
  }

  /** Stable for this revision. Never mutate a returned snapshot or its geometry. */
  getSnapshot(displayId: number): AnnotationDocumentSnapshot {
    const cached = this.snapshots.get(displayId);
    if (cached) return cached;
    const document = this.document(displayId);
    const snapshot: AnnotationDocumentSnapshot = Object.freeze({
      displayId,
      revision: this.revisions.get(displayId) ?? 0,
      viewport: document.viewport
        ? Object.freeze({ ...document.viewport })
        : null,
      elements: Object.freeze(document.elements.slice()),
    });
    this.snapshots.set(displayId, snapshot);
    return snapshot;
  }

  retainDisplays(displayIds: Iterable<number>) {
    const retained = new Set(displayIds);
    let removedDocuments = 0;

    for (const displayId of this.documents.keys()) {
      if (retained.has(displayId)) continue;
      this.documents.delete(displayId);
      this.revisions.delete(displayId);
      this.snapshots.delete(displayId);
      removedDocuments += 1;
    }
    this.undoStack = this.undoStack.filter((entry) =>
      retained.has(entry.displayId),
    );
    this.redoStack = this.redoStack.filter((entry) =>
      retained.has(entry.displayId),
    );
    return removedDocuments;
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
    document.elements = document.elements.map((stroke) =>
      scaleElement(stroke, scaleX, scaleY),
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

  addElement(displayId: number, stroke: AnnotationElement) {
    if (!isAnnotationElement(stroke)) {
      throw new AnnotationError("invalid-element");
    }

    const document = this.document(displayId);
    if (document.elementIds.has(stroke.id)) {
      throw new AnnotationError("duplicate-element");
    }
    if (document.elements.length >= MAX_ANNOTATION_ELEMENTS_PER_DISPLAY) {
      throw new AnnotationError("element-limit");
    }
    if (
      document.pointCount + annotationElementCost(stroke) >
      MAX_ANNOTATION_POINTS_PER_DISPLAY
    ) {
      throw new AnnotationError("point-limit");
    }

    const stored = immutableElement(stroke);
    const entry: AddHistoryEntry = {
      kind: "add",
      displayId,
      stroke: stored,
      index: document.elements.length,
    };
    this.apply(entry);
    this.commit(entry);
    return displayId;
  }

  removeElements(displayId: number, ids: Iterable<string>) {
    const idSet = new Set(ids);
    if (!idSet.size) return null;

    const removed: IndexedElement[] = [];
    this.document(displayId).elements.forEach((stroke, index) => {
      if (!idSet.has(stroke.id)) return;
      removed.push({ stroke, index });
    });
    if (!removed.length) return null;

    const entry: RemoveHistoryEntry = {
      kind: "remove",
      displayId,
      elements: removed,
    };
    this.apply(entry);
    this.commit(entry);
    return displayId;
  }

  translateElements(displayId: number, ids: Iterable<string>, dx: number, dy: number) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new AnnotationError("invalid-element");
    return this.transformElements(displayId, ids, dx === 0 && dy === 0,
      element => translateAnnotationElement(element, dx, dy));
  }

  resizeElements(displayId: number, ids: Iterable<string>, anchor: AnnotationPoint, scaleX: number, scaleY: number) {
    if (!validResizeTransform(anchor, scaleX, scaleY)) throw new AnnotationError("invalid-element");
    return this.transformElements(displayId, ids, scaleX === 1 && scaleY === 1,
      element => resizeAnnotationElement(element, anchor, scaleX, scaleY));
  }

  rotateElements(displayId: number, ids: Iterable<string>, center: AnnotationPoint, radians: number) {
    if (!isFinitePoint(center)) throw new AnnotationError("invalid-element");
    const angle = normalizeRotation(radians);
    return this.transformElements(displayId, ids, angle === 0,
      element => rotateAnnotationElement(element, center, angle));
  }

  /** Build and validate every destination before replacing any source geometry. */
  private transformElements(displayId: number, ids: Iterable<string>, identity: boolean,
    transform: (element: AnnotationElement) => AnnotationElement) {
    const values = [...ids];
    const validIds = readAnnotationElementIds(values);
    if (!validIds || validIds.length !== values.length) throw new AnnotationError("invalid-element");
    if (!validIds.length) return null;
    const document = this.document(displayId);
    if (validIds.some(id => !document.elementIds.has(id))) throw new AnnotationError("stale-document");
    if (identity) return null;
    const selected = new Set(validIds);
    const changes = document.elements.flatMap((before, index) => selected.has(before.id)
      ? [{ index, before, after: transform(before) }] : []);
    const entry: TransformHistoryEntry = { kind: "transform", displayId, changes };
    this.apply(entry);
    this.commit(entry);
    return displayId;
  }

  clearDisplay(displayId: number) {
    return this.removeElements(
      displayId,
      this.document(displayId).elements.map((stroke) => stroke.id),
    );
  }

  undo() {
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry) return null;

    this.revert(entry);
    this.undoStack.pop();
    this.redoStack.push(entry);
    return entry.displayId;
  }

  redo() {
    const entry = this.redoStack[this.redoStack.length - 1];
    if (!entry) return null;

    this.apply(entry);
    this.redoStack.pop();
    this.undoStack.push(entry);
    return entry.displayId;
  }

  private document(displayId: number) {
    const existing = this.documents.get(displayId);
    if (existing) return existing;

    const created: DocumentState = {
      viewport: null,
      elements: [],
      elementIds: new Set(),
      pointCount: 0,
    };
    this.documents.set(displayId, created);
    return created;
  }

  private commit(entry: HistoryEntry) {
    this.undoStack.push(entry);
    this.redoStack = [];

    let retainedPoints = this.undoStack.reduce(
      (total, candidate) => total + historyEntryPointCount(candidate),
      0,
    );
    while (
      this.undoStack.length > MAX_ANNOTATION_HISTORY_ENTRIES ||
      retainedPoints > MAX_ANNOTATION_HISTORY_POINTS
    ) {
      const removed = this.undoStack.shift();
      if (!removed) break;
      retainedPoints -= historyEntryPointCount(removed);
    }
  }

  private touch(displayId: number) {
    this.snapshots.delete(displayId);
    this.revisions.set(displayId, (this.revisions.get(displayId) ?? 0) + 1);
  }

  private apply(entry: HistoryEntry) {
    const document = this.document(entry.displayId);
    if (entry.kind === "transform") {
      this.applyTransform(entry, false);
      return;
    }
    if (entry.kind === "add") {
      if (document.elementIds.has(entry.stroke.id)) {
        throw new AnnotationError("duplicate-element");
      }
      if (document.elements.length >= MAX_ANNOTATION_ELEMENTS_PER_DISPLAY) {
        throw new AnnotationError("element-limit");
      }
      if (
        document.pointCount + annotationElementCost(entry.stroke) >
        MAX_ANNOTATION_POINTS_PER_DISPLAY
      ) {
        throw new AnnotationError("point-limit");
      }

      document.elements.splice(
        Math.min(entry.index, document.elements.length),
        0,
        entry.stroke,
      );
      document.elementIds.add(entry.stroke.id);
      document.pointCount += annotationElementCost(entry.stroke);
      this.touch(entry.displayId);
      return;
    }

    const removedIds = new Set(entry.elements.map(({ stroke }) => stroke.id));
    let removedPointCount = 0;
    document.elements = document.elements.filter((stroke) => {
      if (!removedIds.has(stroke.id)) return true;
      removedPointCount += annotationElementCost(stroke);
      return false;
    });
    removedIds.forEach((id) => document.elementIds.delete(id));
    document.pointCount = Math.max(0, document.pointCount - removedPointCount);
    this.touch(entry.displayId);
  }

  private applyTransform(entry: TransformHistoryEntry, undo: boolean) {
    const document = this.document(entry.displayId);
    if (entry.changes.some(change => document.elements[change.index]?.id !== change.before.id))
      throw new AnnotationError("stale-document");
    const elements = document.elements.slice();
    for (const change of entry.changes) elements[change.index] = undo ? change.before : change.after;
    document.elements = elements;
    this.touch(entry.displayId);
  }

  private revert(entry: HistoryEntry) {
    const document = this.document(entry.displayId);
    if (entry.kind === "transform") {
      this.applyTransform(entry, true);
      return;
    }
    if (entry.kind === "add") {
      const removed = document.elements.find(
        (stroke) => stroke.id === entry.stroke.id,
      );
      document.elements = document.elements.filter(
        (stroke) => stroke.id !== entry.stroke.id,
      );
      document.elementIds.delete(entry.stroke.id);
      if (removed) {
        document.pointCount = Math.max(
          0,
          document.pointCount - annotationElementCost(removed),
        );
      }
      this.touch(entry.displayId);
      return;
    }

    const ordered = [...entry.elements].sort((left, right) => {
      return left.index - right.index;
    });
    const restorable = ordered.filter(
      ({ stroke }) => !document.elementIds.has(stroke.id),
    );
    const restoredPoints = restorable.reduce(
      (total, { stroke }) => total + annotationElementCost(stroke),
      0,
    );
    if (
      document.elements.length + restorable.length >
      MAX_ANNOTATION_ELEMENTS_PER_DISPLAY
    ) {
      throw new AnnotationError("element-limit");
    }
    if (
      document.pointCount + restoredPoints >
      MAX_ANNOTATION_POINTS_PER_DISPLAY
    ) {
      throw new AnnotationError("point-limit");
    }

    restorable.forEach(({ stroke, index }) => {
      document.elements.splice(
        Math.min(index, document.elements.length),
        0,
        stroke,
      );
      document.elementIds.add(stroke.id);
      document.pointCount += annotationElementCost(stroke);
    });
    this.touch(entry.displayId);
  }
}
