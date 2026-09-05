import { AnnotationError, type AnnotationFailureReason } from "./errors.js";
import type { AnnotationHistory, TextElement } from "./history.js";

export interface AnnotationTextEditSession {
  readonly id: string;
  readonly displayId: number;
  readonly revision: number;
  readonly element: TextElement;
}

export type AnnotationTextEditResult =
  | { readonly accepted: true; readonly changed: boolean }
  | { readonly accepted: false; readonly reason: AnnotationFailureReason };

/** One explicit, non-persisted editor session. A save can affect only its original text. */
export class AnnotationTextEditSessions {
  private session: AnnotationTextEditSession | null = null;

  constructor(private readonly history: AnnotationHistory) {}

  get current() { return this.session; }

  open(displayId: number, revision: unknown, elementId: unknown, id: string) {
    if (this.session) throw new AnnotationError("unavailable");
    if (!Number.isSafeInteger(displayId) || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 ||
        typeof elementId !== "string" || !elementId.length || elementId.length > 128 || !id || id.length > 128)
      throw new AnnotationError("invalid-element");
    const document = this.history.getSnapshot(displayId);
    if (revision !== document.revision) throw new AnnotationError("stale-document");
    const element = document.elements.find(item => item.id === elementId);
    if (!element) throw new AnnotationError("stale-document");
    if (element.tool !== "text") throw new AnnotationError("invalid-element");
    this.session = Object.freeze({ id, displayId, revision, element });
    return this.session;
  }

  save(id: unknown, value: unknown) {
    const session = this.session;
    if (!session || id !== session.id) throw new AnnotationError("stale-gesture");
    if (this.history.getSnapshot(session.displayId).revision !== session.revision)
      throw new AnnotationError("stale-document");
    const changed = this.history.editText(session.displayId, session.element.id, value) !== null;
    this.session = null;
    return { displayId: session.displayId, changed };
  }

  cancel(id?: unknown) {
    if (!this.session || (id !== undefined && id !== this.session.id)) return false;
    this.session = null;
    return true;
  }
}
