import {
  copyAnnotationElements,
  isAnnotationElement,
  resizeAnnotationElement,
  translateAnnotationElement,
  type AnnotationDocumentSnapshot,
  type AnnotationElement,
  type AnnotationViewport,
} from "./history.js";

export const MAX_ANNOTATION_FILE_BYTES = 64 * 1024 * 1024;
export const ANNOTATION_FILE_EXTENSION = "minicast";

export interface AnnotationFile {
  readonly format: "MiniCast";
  readonly version: 1;
  readonly viewport: AnnotationViewport;
  readonly elements: readonly AnnotationElement[];
}

export type AnnotationFileFailure =
  | "invalid-request" | "invalid-file" | "unsupported-version" | "too-large"
  | "unavailable" | "busy" | "stale-document" | "read-failed" | "write-failed"
  | "cannot-fit";
export class AnnotationFileError extends Error {
  constructor(public readonly reason: AnnotationFileFailure) {
    super(`Annotation file: ${reason}`);
    this.name = "AnnotationFileError";
  }
}
export interface AnnotationFileRequest {
  displayId: number;
  action: "save" | "open";
}
export type AnnotationFileResult =
  | { status: "saved" | "opened"; fileName: string; elements: number; revision: number; changed: boolean }
  | { status: "cancelled" }
  | { status: "error"; reason: AnnotationFileFailure };

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: RecordValue, required: readonly string[], optional: readonly string[] = []) {
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function viewport(value: unknown): value is AnnotationViewport {
  return record(value) && keys(value, ["width", "height"]) &&
    [value.width, value.height].every(n => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 100_000);
}

export function readAnnotationFileRequest(value: unknown): AnnotationFileRequest | null {
  if (!record(value) || !keys(value, ["displayId", "action"]) || !Number.isSafeInteger(value.displayId) ||
      (value.action !== "save" && value.action !== "open")) return null;
  return { displayId: value.displayId as number, action: value.action };
}

/** The file contains only current object data, never code, URLs, paths, history or UI state. */
export function readAnnotationFile(value: unknown): AnnotationFile {
  if (!record(value) || value.format !== "MiniCast") throw new AnnotationFileError("invalid-file");
  if (value.version !== 1) throw new AnnotationFileError("unsupported-version");
  if (!keys(value, ["format", "version", "viewport", "elements"]) || !viewport(value.viewport) || !Array.isArray(value.elements))
    throw new AnnotationFileError("invalid-file");
  // Bound collection work before inspecting nested objects.
  let elements: readonly AnnotationElement[];
  try { elements = copyAnnotationElements(value.elements); }
  catch { throw new AnnotationFileError("invalid-file"); }
  for (const element of value.elements) {
    if (!record(element)) throw new AnnotationFileError("invalid-file");
    const common = ["id", "tool", "color", "opacity", "points"];
    const required = element.tool === "text" ? [...common, "text", "fontSize", "box"] : [...common, "width"];
    const optional = element.tool === "rectangle" || element.tool === "ellipse" ? ["fill"] : [];
    if (!keys(element, required, optional) ||
        !(element.points as unknown[]).every(point => record(point) && keys(point, ["x", "y"])) ||
        (element.tool === "text" && (!record(element.box) || !keys(element.box, ["minX", "minY", "maxX", "maxY"]))))
      throw new AnnotationFileError("invalid-file");
  }
  return Object.freeze({ format: "MiniCast", version: 1,
    viewport: Object.freeze({ width: value.viewport.width, height: value.viewport.height }), elements });
}

export function createAnnotationFile(snapshot: AnnotationDocumentSnapshot): AnnotationFile {
  if (!snapshot.viewport) throw new AnnotationFileError("unavailable");
  return readAnnotationFile({ format: "MiniCast", version: 1, viewport: snapshot.viewport, elements: snapshot.elements });
}

export function parseAnnotationFile(text: string): AnnotationFile {
  if (typeof text !== "string") throw new AnnotationFileError("invalid-file");
  if (text.length > MAX_ANNOTATION_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_ANNOTATION_FILE_BYTES)
    throw new AnnotationFileError("too-large");
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new AnnotationFileError("invalid-file"); }
  return readAnnotationFile(value);
}

export function serializeAnnotationFile(snapshot: AnnotationDocumentSnapshot): string {
  const text = JSON.stringify(createAnnotationFile(snapshot)) + "\n";
  if (new TextEncoder().encode(text).byteLength > MAX_ANNOTATION_FILE_BYTES) throw new AnnotationFileError("too-large");
  return text;
}

/** Fit the saved viewport uniformly; identical viewports retain every exact coordinate. */
export function fitAnnotationFile(file: AnnotationFile, target: AnnotationViewport): readonly AnnotationElement[] {
  if (!viewport(target)) throw new AnnotationFileError("unavailable");
  const scale = Math.min(target.width / file.viewport.width, target.height / file.viewport.height);
  const dx = (target.width - file.viewport.width * scale) / 2;
  const dy = (target.height - file.viewport.height * scale) / 2;
  if (scale === 1 && dx === 0 && dy === 0) return file.elements;
  try {
    return Object.freeze(file.elements.map(element => {
      const resized = resizeAnnotationElement(element, { x: 0, y: 0 }, scale, scale);
      const fitted = dx === 0 && dy === 0 ? resized : translateAnnotationElement(resized, dx, dy);
      if (!isAnnotationElement(fitted)) throw new AnnotationFileError("cannot-fit");
      return fitted;
    }));
  } catch { throw new AnnotationFileError("cannot-fit"); }
}

export function annotationFileMessage(reason: AnnotationFileFailure) {
  const messages: Record<AnnotationFileFailure, string> = {
    "invalid-request": "판서 파일 요청이 올바르지 않습니다.",
    "invalid-file": "올바른 MiniCast 판서 파일이 아닙니다. 현재 판서는 그대로 유지했습니다.",
    "unsupported-version": "지원하지 않는 판서 파일 버전입니다. 현재 판서는 그대로 유지했습니다.",
    "too-large": "판서 파일은 64MiB 이하여야 합니다.",
    unavailable: "화면을 다시 연결하거나 텍스트 편집을 마친 뒤 시도하세요.",
    busy: "다른 저장·열기·이미지 내보내기가 진행 중입니다.",
    "stale-document": "파일을 여는 동안 현재 판서가 변경됐습니다. 덮어쓰지 않았으니 다시 열어 주세요.",
    "read-failed": "파일을 읽지 못했습니다. 경로·권한을 확인한 뒤 다시 열어 주세요.",
    "write-failed": "판서 파일을 저장하지 못했습니다. .minicast 확장자와 폴더 권한을 확인하세요.",
    "cannot-fit": "현재 화면에 맞추면 좌표·선 굵기 한도를 벗어납니다. 원래 크기에 가까운 화면에서 열어 주세요.",
  };
  return messages[reason];
}
