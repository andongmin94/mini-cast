import { AnnotationError } from "./errors.js";
import {
  MAX_ANNOTATION_COORDINATE,
  readAnnotationElementIds,
  translateAnnotationElement,
  type AnnotationHistory,
  type AnnotationElement,
  type AnnotationPoint,
} from "./history.js";
import { pointHitsStroke } from "./geometry.js";
import { elementInkBounds, type InkBounds } from "./shape-geometry.js";

interface SelectionEditBase {
  readonly revision: number;
  readonly ids: readonly string[];
}

export type AnnotationSelectionEdit =
  | (SelectionEditBase & { readonly kind: "move"; readonly dx: number; readonly dy: number })
  | (SelectionEditBase & { readonly kind: "delete" });

/** Validate the complete edit before touching the document or its history. */
export function readAnnotationSelectionEdit(value: unknown): AnnotationSelectionEdit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.revision !== "number" || !Number.isSafeInteger(data.revision) || data.revision < 0) return null;
  const ids = readAnnotationElementIds(data.ids);
  if (!ids?.length || ids.length !== (data.ids as unknown[]).length) return null;
  if (data.kind === "delete") return { kind: "delete", revision: data.revision, ids };
  if (data.kind !== "move" || typeof data.dx !== "number" || typeof data.dy !== "number" ||
      !Number.isFinite(data.dx) || !Number.isFinite(data.dy) ||
      Math.abs(data.dx) > 2 * MAX_ANNOTATION_COORDINATE || Math.abs(data.dy) > 2 * MAX_ANNOTATION_COORDINATE) return null;
  return { kind: "move", revision: data.revision, ids, dx: data.dx, dy: data.dy };
}

/** Optimistic concurrency protects an edit from a concurrent Undo or display reset. */
export function applyAnnotationSelectionEdit(history: AnnotationHistory, displayId: number, value: unknown) {
  const edit = readAnnotationSelectionEdit(value);
  if (!edit) throw new AnnotationError("invalid-element");
  const document = history.getSnapshot(displayId);
  if (document.revision !== edit.revision) throw new AnnotationError("stale-document");
  const present = new Set(document.elements.map(element => element.id));
  if (edit.ids.some(id => !present.has(id))) throw new AnnotationError("stale-document");
  return edit.kind === "delete"
    ? history.removeElements(displayId, edit.ids)
    : history.translateElements(displayId, edit.ids, edit.dx, edit.dy);
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
