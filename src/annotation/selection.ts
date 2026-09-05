import { normalizeRotation, selectionRotationCenter } from "./rotation.js";
import { AnnotationError } from "./errors.js";
import {
  MAX_ANNOTATION_COORDINATE,
  readAnnotationElementIds,
  translateAnnotationElement,
  resizeAnnotationElement,
  rotateAnnotationElement,
  flipAnnotationElement,
  fillAnnotationElement,
  isAnnotationFill,
  isFlipAxis,
  type FlipAxis,
  type AnnotationHistory,
  type AnnotationElement,
  type AnnotationPoint,
} from "./history.js";
import { pointHitsStroke } from "./geometry.js";
import { elementInkBounds, type InkBounds } from "./shape-geometry.js";
import { isResizeHandle, selectionResizeTransform, type ResizeHandle } from "./resize.js";

interface SelectionEditBase {
  readonly revision: number;
  readonly ids: readonly string[];
}

export type AnnotationSelectionEdit =
  | (SelectionEditBase & { readonly kind: "move"; readonly dx: number; readonly dy: number })
  | (SelectionEditBase & { readonly kind: "resize"; readonly handle: ResizeHandle;
      readonly dx: number; readonly dy: number; readonly lockAspect: boolean })
  | (SelectionEditBase & { readonly kind: "rotate"; readonly radians: number })
  | (SelectionEditBase & { readonly kind: "flip"; readonly axis: FlipAxis })
  | (SelectionEditBase & { readonly kind: "fill"; readonly fill: string | null })
  | (SelectionEditBase & { readonly kind: "delete" });

/** Validate the complete edit before touching the document or its history. */
export function readAnnotationSelectionEdit(value: unknown): AnnotationSelectionEdit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.revision !== "number" || !Number.isSafeInteger(data.revision) || data.revision < 0) return null;
  const ids = readAnnotationElementIds(data.ids);
  if (!ids?.length || ids.length !== (data.ids as unknown[]).length) return null;
  if (data.kind === "fill") return isAnnotationFill(data.fill)
    ? { kind: "fill", revision: data.revision, ids, fill: data.fill } : null;
  if (data.kind === "delete") return { kind: "delete", revision: data.revision, ids };
  if (data.kind === "flip") return isFlipAxis(data.axis)
    ? { kind: "flip", revision: data.revision, ids, axis: data.axis } : null;
  if (data.kind === "rotate") {
    if (typeof data.radians !== "number") return null;
    try { return { kind: "rotate", revision: data.revision, ids, radians: normalizeRotation(data.radians) }; }
    catch { return null; }
  }
  if ((data.kind !== "move" && data.kind !== "resize") || typeof data.dx !== "number" || typeof data.dy !== "number" ||
      !Number.isFinite(data.dx) || !Number.isFinite(data.dy) ||
      Math.abs(data.dx) > 2 * MAX_ANNOTATION_COORDINATE || Math.abs(data.dy) > 2 * MAX_ANNOTATION_COORDINATE) return null;
  if (data.kind === "move") return { kind: "move", revision: data.revision, ids, dx: data.dx, dy: data.dy };
  if (!isResizeHandle(data.handle) || typeof data.lockAspect !== "boolean") return null;
  return { kind: "resize", revision: data.revision, ids, handle: data.handle,
    dx: data.dx, dy: data.dy, lockAspect: data.lockAspect };
}

/** Optimistic concurrency protects an edit from a concurrent Undo or display reset. */
export function applyAnnotationSelectionEdit(history: AnnotationHistory, displayId: number, value: unknown) {
  const edit = readAnnotationSelectionEdit(value);
  if (!edit) throw new AnnotationError("invalid-element");
  const document = history.getSnapshot(displayId);
  if (document.revision !== edit.revision) throw new AnnotationError("stale-document");
  const present = new Set(document.elements.map(element => element.id));
  if (edit.ids.some(id => !present.has(id))) throw new AnnotationError("stale-document");
  if (edit.kind === "fill") return history.fillElements(displayId, edit.ids, edit.fill);
  if (edit.kind === "delete") return history.removeElements(displayId, edit.ids);
  if (edit.kind === "move") return history.translateElements(displayId, edit.ids, edit.dx, edit.dy);
  // Never trust a renderer-supplied pivot or bounding box.
  const bounds = annotationSelectionBounds(document.elements, new Set(edit.ids));
  if (!bounds) throw new AnnotationError("stale-document");
  if (edit.kind === "flip") return history.flipElements(displayId, edit.ids, selectionRotationCenter(bounds), edit.axis);
  if (edit.kind === "rotate") return history.rotateElements(displayId, edit.ids, selectionRotationCenter(bounds), edit.radians);
  const transform = selectionResizeTransform(bounds, edit.handle, edit.dx, edit.dy, edit.lockAspect);
  return history.resizeElements(displayId, edit.ids, transform.anchor, transform.scaleX, transform.scaleY);
}

/** Match visible ink, not an empty shape interior, and prefer the topmost object. */
export function hitTestAnnotationSelection(
  elements: readonly AnnotationElement[], point: AnnotationPoint, tolerance = 6,
): string | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(tolerance)) return null;
  const radius = Math.max(0, tolerance);
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    const box = elementInkBounds(element);
    if (point.x < box.minX - radius || point.x > box.maxX + radius ||
        point.y < box.minY - radius || point.y > box.maxY + radius) continue;
    if (pointHitsStroke(point, element, radius)) return element.id;
  }
  return null;
}

/** A normal click keeps an existing group; Shift toggles exactly one object. */
export function selectionAfterClick(
  selected: readonly string[], hit: string | null, toggle: boolean,
): string[] {
  if (hit === null) return toggle ? [...selected] : [];
  if (toggle) return selected.includes(hit) ? selected.filter(id => id !== hit) : [...selected, hit];
  return selected.includes(hit) ? [...selected] : [hit];
}

export function annotationSelectionBounds(
  elements: readonly AnnotationElement[], selected: ReadonlySet<string>,
): InkBounds | null {
  let bounds: InkBounds | null = null;
  for (const element of elements) {
    if (!selected.has(element.id)) continue;
    const box = elementInkBounds(element);
    bounds = bounds ? {
      minX: Math.min(bounds.minX, box.minX), minY: Math.min(bounds.minY, box.minY),
      maxX: Math.max(bounds.maxX, box.maxX), maxY: Math.max(bounds.maxY, box.maxY),
    } : { ...box };
  }
  return bounds;
}

/** Preview and committed geometry share the same translation implementation. */
export function translateSelectionElements(
  elements: readonly AnnotationElement[], selected: ReadonlySet<string>, dx: number, dy: number,
): readonly AnnotationElement[] {
  if (dx === 0 && dy === 0) return elements;
  return elements.map(element => selected.has(element.id) ? translateAnnotationElement(element, dx, dy) : element);
}

/** Always transform the pointer-down document, never an already rounded preview. */
export function resizeSelectionElements(
  elements: readonly AnnotationElement[], selected: ReadonlySet<string>,
  handle: ResizeHandle, dx: number, dy: number, lockAspect: boolean,
): readonly AnnotationElement[] {
  const bounds = annotationSelectionBounds(elements, selected);
  if (!bounds) return elements;
  const { anchor, scaleX, scaleY } = selectionResizeTransform(bounds, handle, dx, dy, lockAspect);
  if (scaleX === 1 && scaleY === 1) return elements;
  return elements.map(element => selected.has(element.id)
    ? resizeAnnotationElement(element, anchor, scaleX, scaleY) : element);
}

/** Rotate from the pointer-down document, with the same authoritative pivot. */
export function rotateSelectionElements(elements: readonly AnnotationElement[], selected: ReadonlySet<string>, radians: number): readonly AnnotationElement[] {
  const angle = normalizeRotation(radians);
  if (angle === 0) return elements;
  const bounds = annotationSelectionBounds(elements, selected);
  if (!bounds) return elements;
  const center = selectionRotationCenter(bounds);
  return elements.map(element => selected.has(element.id) ? rotateAnnotationElement(element, center, angle) : element);
}

/** A group reflects about its shared visible center, never each element's center. */
export function flipSelectionElements(elements: readonly AnnotationElement[], selected: ReadonlySet<string>, axis: FlipAxis): readonly AnnotationElement[] {
  if (!isFlipAxis(axis)) throw new AnnotationError("invalid-element");
  const bounds = annotationSelectionBounds(elements, selected);
  if (!bounds) return elements;
  const center = selectionRotationCenter(bounds);
  let changed = false;
  const result = elements.map(element => {
    if (!selected.has(element.id)) return element;
    const next = flipAnnotationElement(element, center, axis);
    if (next !== element) changed = true;
    return next;
  });
  return changed ? result : elements;
}

/** Style preview shares the same validation as the atomic history edit. */
export function fillSelectionElements(elements: readonly AnnotationElement[], selected: ReadonlySet<string>, fill: string | null): readonly AnnotationElement[] {
  return elements.map(element => selected.has(element.id) ? fillAnnotationElement(element, fill) : element);
}
