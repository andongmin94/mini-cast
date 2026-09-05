import { renderAnnotationPng } from "@/annotation/export-renderer";
import { planAnnotationExport } from "@/annotation/export";

export function listenForAnnotationExports(displayId: () => number | null) {
  let alive = true;
  let rendering = false;
  const stop = miniCast.onAnnotationExportRender(request => {
    void (async () => {
      if (rendering) { miniCast.completeAnnotationExport(request.id, null); return; }
      rendering = true;
      try {
        if (request.snapshot.displayId !== displayId()) throw new Error("Foreign export display");
        const size = planAnnotationExport(request.snapshot, request.scale);
        if (size.width !== request.width || size.height !== request.height) throw new Error("Export size mismatch");
        const bytes = await renderAnnotationPng(window.document, request.snapshot, request.scale, () => !alive);
        if (alive) miniCast.completeAnnotationExport(request.id, bytes);
      } catch {
        if (alive) miniCast.completeAnnotationExport(request.id, null);
      } finally { rendering = false; }
    })();
  });
  return () => { alive = false; stop(); };
}
