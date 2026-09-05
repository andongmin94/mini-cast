import { textControlPoints } from "./primitive-frame.js";
import type { AnnotationPoint, TextElement } from "./history.js";

export const TEXT_FONT_FAMILY = '"Pretendard", sans-serif';
export const MAX_ANNOTATION_TEXT_LENGTH = 2000;
export const MAX_ANNOTATION_TEXT_LINES = 20;
export const TEXT_LINE_HEIGHT = 1.4;

export interface AnnotationTextDraft {
  readonly text: string;
  readonly fontSize: number;
}

export interface AnnotationTextReplacement extends AnnotationTextDraft {
  readonly box: TextInkBox;
}

export interface TextInkBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Newlines are allowed; tabs and CR are normalized before this check. */
function hasUnsupportedControlCharacters(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code < 32 && code !== 10) || code === 127) return true;
  }
  return false;
}

/** Plain text only; no HTML, persisted draft, or font/URL supplied over IPC. */
export function readAnnotationTextDraft(
  value: unknown,
): AnnotationTextDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  if (typeof draft.text !== "string" || typeof draft.fontSize !== "number") {
    return null;
  }
  const text = draft.text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  if (
    !text.trim() ||
    text.length > MAX_ANNOTATION_TEXT_LENGTH ||
    text.split("\n").length > MAX_ANNOTATION_TEXT_LINES ||
    hasUnsupportedControlCharacters(text) ||
    !Number.isFinite(draft.fontSize) ||
    draft.fontSize < 12 ||
    draft.fontSize > 96
  ) {
    return null;
  }
  return Object.freeze({ text, fontSize: draft.fontSize });
}

export function annotationTextFont(fontSize: number) {
  return `400 ${fontSize}px ${TEXT_FONT_FAMILY}`;
}

/** The caller loads the bundled font before measuring or painting. */
export function createTextElement(
  context: CanvasRenderingContext2D,
  id: string,
  draft: AnnotationTextDraft,
  position: AnnotationPoint,
  color: string,
): TextElement {
  const valid = readAnnotationTextDraft(draft);
  if (!valid) throw new Error("Invalid annotation text");
  const box = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const lines = valid.text.split("\n");
  context.save();
  try {
    context.font = annotationTextFont(valid.fontSize);
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.direction = "ltr";
    lines.forEach((line, index) => {
      const baseline = valid.fontSize * (1 + index * TEXT_LINE_HEIGHT);
      const metrics = context.measureText(line);
      box.minX = Math.min(box.minX, -metrics.actualBoundingBoxLeft);
      box.minY = Math.min(box.minY, baseline - metrics.actualBoundingBoxAscent);
      box.maxX = Math.max(box.maxX, metrics.width, metrics.actualBoundingBoxRight);
      box.maxY = Math.max(box.maxY, baseline + metrics.actualBoundingBoxDescent);
    });
    // Keep blank-line spacing inside the object's eraser bounds as well.
    box.maxY = Math.max(box.maxY, valid.fontSize * lines.length * TEXT_LINE_HEIGHT);
  } finally {
    context.restore();
  }
  if (box.maxX <= box.minX || box.maxY <= box.minY) {
    throw new Error("Annotation text has no measurable extent");
  }
  return { id, tool: "text", points: textControlPoints(position), color,
    opacity: 1, text: valid.text, fontSize: valid.fontSize, box };
}
