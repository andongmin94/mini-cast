import { drawAnnotationElement } from "./canvas-renderer.js";
import { AnnotationExportError, MAX_EXPORT_PNG_BYTES, planAnnotationExport } from "./export.js";
import type { AnnotationDocumentSnapshot } from "./history.js";
import { annotationTextFont } from "./text.js";

export async function loadAnnotationExportFonts(
  ownerDocument: Pick<Document, "fonts">,
  snapshot: AnnotationDocumentSnapshot,
) {
  const fonts = new Map<string, string>();
  for (const element of snapshot.elements) if (element.tool === "text") {
    const font = annotationTextFont(element.fontSize);
    fonts.set(font, (fonts.get(font) ?? "") + element.text);
  }
  const loaded = await Promise.all(
    [...fonts].map(([font, text]) => ownerDocument.fonts.load(font, text)),
  );
  if (loaded.some(faces => faces.length === 0))
    throw new AnnotationExportError("render-failed");
}

/** Export the pinned document, not live DOM pixels, previews, handles or desktop content. */
export async function renderAnnotationPng(
  ownerDocument: Document,
  snapshot: AnnotationDocumentSnapshot,
  scale: number,
  cancelled: () => boolean = () => false,
): Promise<Uint8Array> {
  const { width, height } = planAnnotationExport(snapshot, scale);
  await loadAnnotationExportFonts(ownerDocument, snapshot);
  if (cancelled()) throw new AnnotationExportError("cancelled");
  const canvas = ownerDocument.createElement("canvas");
  try {
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new AnnotationExportError("render-failed");
    context.setTransform(scale, 0, 0, scale, 0, 0);
    for (const element of snapshot.elements) drawAnnotationElement(context, element);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new AnnotationExportError("render-failed")), "image/png");
    });
    if (blob.size > MAX_EXPORT_PNG_BYTES) throw new AnnotationExportError("too-large");
    if (cancelled()) throw new AnnotationExportError("cancelled");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (cancelled()) throw new AnnotationExportError("cancelled");
    return bytes;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
