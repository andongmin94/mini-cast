import type { AnnotationDocumentSnapshot } from "./history.js";

export function shouldAdoptAnnotationDocument(
  displayId: number | null,
  currentRevision: number,
  next: AnnotationDocumentSnapshot,
) {
  return next.displayId === displayId && next.revision >= currentRevision;
}
