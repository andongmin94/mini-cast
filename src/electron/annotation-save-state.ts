import { createHash } from "node:crypto";
import type { AnnotationDocumentSnapshot } from "../annotation/history.js";

/** Saved-content fingerprints, not revision numbers or copies of historical geometry. */
export class AnnotationSaveState {
  private readonly saved = new Map<number, string>();
  private readonly fingerprints = new WeakMap<AnnotationDocumentSnapshot, string>();

  markSaved(snapshot: AnnotationDocumentSnapshot): void {
    this.saved.set(snapshot.displayId, this.fingerprint(snapshot));
  }

  isDirty(snapshot: AnnotationDocumentSnapshot): boolean {
    const saved = this.saved.get(snapshot.displayId);
    if (saved === undefined && snapshot.elements.length === 0) return false;
    return saved !== this.fingerprint(snapshot);
  }

  /** A discard decision is valid only for the exact set of contents the user reviewed. */
  key(snapshots: readonly AnnotationDocumentSnapshot[]): string | null {
    const dirty = snapshots.filter(snapshot => this.isDirty(snapshot))
      .sort((a, b) => a.displayId - b.displayId)
      .map(snapshot => [snapshot.displayId, this.fingerprint(snapshot)]);
    return dirty.length ? JSON.stringify(dirty) : null;
  }

  retainDisplays(displayIds: Iterable<number>): void {
    const ids = new Set(displayIds);
    for (const id of this.saved.keys()) if (!ids.has(id)) this.saved.delete(id);
  }

  private fingerprint(snapshot: AnnotationDocumentSnapshot): string {
    const cached = this.fingerprints.get(snapshot);
    if (cached) return cached;
    if (!snapshot.viewport) throw new Error("Cannot identify an unavailable annotation document");
    const hash = createHash("sha256");
    hash.update(JSON.stringify([snapshot.viewport.width, snapshot.viewport.height]));
    // Explicit tuples make property insertion order irrelevant, including files opened from JSON.
    for (const element of snapshot.elements) {
      const style = element.tool === "text"
        ? [element.text, element.fontSize, element.box.minX, element.box.minY, element.box.maxX, element.box.maxY]
        : [element.width, "fill" in element ? element.fill ?? null : null];
      hash.update(JSON.stringify([element.id, element.tool, element.color, element.opacity, style,
        element.points.map(point => [point.x, point.y])]));
    }
    const fingerprint = hash.digest("hex");
    this.fingerprints.set(snapshot, fingerprint);
    return fingerprint;
  }
}
