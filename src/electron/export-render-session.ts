import { AnnotationExportError, hasExpectedPngHeader, type AnnotationExportSize } from "../annotation/export.js";

/** One bounded render request; replies are bound to both a window and a random job token. */
export class ExportRenderSession {
  private pending: {
    ownerId: number;
    id: string;
    size: AnnotationExportSize;
    timer: ReturnType<typeof setTimeout>;
    resolve(bytes: Uint8Array): void;
    reject(error: AnnotationExportError): void;
  } | null = null;

  begin(ownerId: number, id: string, size: AnnotationExportSize, timeoutMs = 15_000): Promise<Uint8Array> {
    if (this.pending) throw new AnnotationExportError("busy");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancel("timeout"), timeoutMs);
      this.pending = { ownerId, id, size: { ...size }, timer, resolve, reject };
    });
  }

  reply(ownerId: number, id: unknown, bytes: unknown) {
    const pending = this.pending;
    if (!pending || pending.ownerId !== ownerId || pending.id !== id) return false;
    this.pending = null;
    clearTimeout(pending.timer);
    if (!hasExpectedPngHeader(bytes, pending.size)) pending.reject(new AnnotationExportError("render-failed"));
    else pending.resolve(new Uint8Array(bytes));
    return true;
  }

  cancel(reason: "cancelled" | "timeout" | "unavailable" = "cancelled") {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(new AnnotationExportError(reason));
  }
}
