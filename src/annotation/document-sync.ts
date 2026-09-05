import type { AnnotationFailureReason } from "./errors.js";
import {
  isAnnotationStroke,
  type AnnotationDocumentSnapshot,
  type AnnotationStroke,
} from "./history.js";

export interface AnnotationDelta {
  readonly kind: "delta";
  readonly displayId: number;
  readonly baseRevision: number;
  readonly revision: number;
  readonly removedIds: readonly string[];
  /** Indices refer to the final document after removals and all insertions. */
  readonly inserted: readonly {
    readonly index: number;
    readonly stroke: AnnotationStroke;
  }[];
}

export type AnnotationDocumentUpdate =
  | { readonly kind: "snapshot"; readonly document: AnnotationDocumentSnapshot }
  | AnnotationDelta
  | {
      readonly kind: "revision";
      readonly displayId: number;
      readonly revision: number;
    };

export type AnnotationMutationResult =
  | { accepted: true; update: AnnotationDocumentUpdate }
  | {
      accepted: false;
      reason: AnnotationFailureReason;
      update: AnnotationDocumentUpdate | null;
    };

/** Immutable history references let us inspect IDs without traversing old point arrays. */
export function createAnnotationUpdate(
  previous: AnnotationDocumentSnapshot | undefined,
  next: AnnotationDocumentSnapshot,
): AnnotationDocumentUpdate {
  if (
    !previous ||
    previous.displayId !== next.displayId ||
    previous.revision >= next.revision ||
    previous.viewport?.width !== next.viewport?.width ||
    previous.viewport?.height !== next.viewport?.height
  ) {
    return { kind: "snapshot", document: next };
  }
  const oldById = new Map(
    previous.strokes.map((stroke) => [stroke.id, stroke]),
  );
  const newById = new Map(next.strokes.map((stroke) => [stroke.id, stroke]));
  const removedIds = previous.strokes
    .filter((stroke) => newById.get(stroke.id) !== stroke)
    .map((stroke) => stroke.id);
  const inserted = next.strokes.flatMap((stroke, index) =>
    oldById.get(stroke.id) === stroke ? [] : [{ index, stroke }],
  );
  // Reordering existing objects is a document reset, not an append/remove operation.
  const retained = previous.strokes.filter(
    (stroke) => newById.get(stroke.id) === stroke,
  );
  let cursor = 0;
  for (const stroke of next.strokes) {
    if (oldById.get(stroke.id) === stroke && retained[cursor++] !== stroke)
      return { kind: "snapshot", document: next };
  }
  return {
    kind: "delta",
    displayId: next.displayId,
    baseRevision: previous.revision,
    revision: next.revision,
    removedIds,
    inserted,
  };
}

export type AnnotationUpdateDecision =
  | { kind: "adopt"; document: AnnotationDocumentSnapshot }
  | { kind: "ignore" }
  | { kind: "resync" };

/** Pure and atomic: gaps and malformed deltas never partially mutate a document. */
export function reduceAnnotationUpdate(
  current: AnnotationDocumentSnapshot | null,
  displayId: number | null,
  update: AnnotationDocumentUpdate,
): AnnotationUpdateDecision {
  const id =
    update.kind === "snapshot" ? update.document.displayId : update.displayId;
  const revision =
    update.kind === "snapshot" ? update.document.revision : update.revision;
  if (displayId === null || id !== displayId) return { kind: "ignore" };
  if (!Number.isSafeInteger(revision) || revision < 0)
    return { kind: "resync" };
  if (update.kind === "snapshot") {
    if (current && revision < current.revision) return { kind: "ignore" };
    if (current === update.document) return { kind: "ignore" };
    return { kind: "adopt", document: update.document };
  }
  if (current && revision <= current.revision) return { kind: "ignore" };
  if (
    update.kind === "revision" ||
    !current ||
    !Number.isSafeInteger(update.baseRevision) ||
    update.baseRevision !== current.revision ||
    revision <= update.baseRevision
  )
    return { kind: "resync" };

  const removed = new Set(update.removedIds);
  const currentIds = new Set(current.strokes.map((stroke) => stroke.id));
  if (
    removed.size !== update.removedIds.length ||
    update.removedIds.some((id) => !currentIds.has(id))
  )
    return { kind: "resync" };
  const survivors = current.strokes.filter((stroke) => !removed.has(stroke.id));
  const finalLength = survivors.length + update.inserted.length;
  const ids = new Set(survivors.map((stroke) => stroke.id));
  let previousIndex = -1;
  for (const { index, stroke } of update.inserted) {
    if (
      !Number.isSafeInteger(index) ||
      index <= previousIndex ||
      index >= finalLength ||
      !isAnnotationStroke(stroke) ||
      ids.has(stroke.id)
    )
      return { kind: "resync" };
    ids.add(stroke.id);
    previousIndex = index;
  }
  // One linear merge, including Undo of thousands of deleted strokes.
  const strokes: AnnotationStroke[] = [];
  let insertion = 0;
  let survivor = 0;
  for (let index = 0; index < finalLength; index += 1) {
    const item = update.inserted[insertion];
    if (item?.index === index) {
      strokes.push(item.stroke);
      insertion += 1;
    } else {
      strokes.push(survivors[survivor++]);
    }
  }
  return {
    kind: "adopt",
    document: {
      displayId,
      revision,
      viewport: current.viewport,
      strokes,
    },
  };
}

/** One owner for both pushed updates and invoke results; never depend on their arrival order. */
export class AnnotationReplica {
  private displayId: number | null = null;
  private generation = 0;
  private current: AnnotationDocumentSnapshot | null = null;
  private recovery: Promise<void> | null = null;

  constructor(
    private readonly fetchSnapshot: () => Promise<AnnotationDocumentSnapshot>,
    private readonly onDocument: (document: AnnotationDocumentSnapshot) => void,
  ) {}

  get document() {
    return this.current;
  }

  reset(displayId: number | null) {
    this.generation += 1;
    this.displayId = displayId;
    this.current = null;
    this.recovery = null;
  }

  private adopt(document: AnnotationDocumentSnapshot) {
    this.current = document;
    this.onDocument(document);
  }

  async receive(
    update: AnnotationDocumentUpdate,
  ): Promise<AnnotationDocumentSnapshot | null> {
    const generation = this.generation;
    const decision = reduceAnnotationUpdate(
      this.current,
      this.displayId,
      update,
    );
    if (decision.kind === "adopt") this.adopt(decision.document);
    if (decision.kind !== "resync") return this.current;

    const requiredRevision =
      update.kind === "snapshot" ? update.document.revision : update.revision;
    // A recovery already in flight can predate this update. Join it, then fetch once
    // more if necessary. Requests started after the update must observe its revision.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.recovery) {
        const request = Promise.resolve()
          .then(() => this.fetchSnapshot())
          .then((snapshot) => {
            if (generation !== this.generation) return;
            const result = reduceAnnotationUpdate(
              this.current,
              this.displayId,
              { kind: "snapshot", document: snapshot },
            );
            if (result.kind === "adopt") this.adopt(result.document);
          });
        this.recovery = request;
        void request
          .finally(() => {
            if (this.recovery === request) this.recovery = null;
          })
          .catch(() => {
            /* The awaiting caller owns the visible failure. */
          });
      }
      try {
        await this.recovery;
      } catch (error) {
        // A late failure belongs to its original generation. A newer pushed
        // snapshot can also have completed the recovery before this reply fails.
        if (generation !== this.generation) return null;
        if (this.current && this.current.revision >= requiredRevision)
          return this.current;
        throw error;
      }
      if (generation !== this.generation) return null;
      if (this.current && this.current.revision >= requiredRevision)
        return this.current;
    }
    throw new Error(
      "Annotation resynchronization did not reach the required revision",
    );
  }
}
