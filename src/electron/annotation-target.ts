export type AnnotationCommandOrigin = "controller" | "shortcut";

export function resolveClearDisplayId(
  origin: AnnotationCommandOrigin,
  cursorDisplayId: number,
  lastAnnotationDisplayId: number | null,
  connectedDisplayIds: readonly number[],
): number | null {
  if (
    origin === "controller" &&
    lastAnnotationDisplayId !== null &&
    connectedDisplayIds.includes(lastAnnotationDisplayId)
  ) {
    return lastAnnotationDisplayId;
  }

  if (connectedDisplayIds.includes(cursorDisplayId)) return cursorDisplayId;
  return connectedDisplayIds[0] ?? null;
}
