import type { AnnotationDocumentSnapshot } from "./history.js";

export const MAX_EXPORT_PIXELS = 16_777_216;
export const MAX_EXPORT_SIDE = 8192;
export const MAX_EXPORT_PNG_BYTES = 68 * 1024 * 1024;

export type AnnotationExportDestination = "file" | "clipboard";
export interface AnnotationExportRequest {
  displayId: number;
  destination: AnnotationExportDestination;
}
export interface AnnotationExportSize { width: number; height: number }
export interface AnnotationExportRenderRequest extends AnnotationExportSize {
  id: string;
  snapshot: AnnotationDocumentSnapshot;
  scale: number;
}
export type AnnotationExportFailure =
  | "invalid-request" | "empty" | "too-large" | "unavailable" | "busy"
  | "timeout" | "render-failed" | "write-failed" | "cancelled";
export type AnnotationExportResult =
  | ({ status: "saved" | "copied"; revision: number; fileName?: string } & AnnotationExportSize)
  | { status: "cancelled" }
  | { status: "error"; reason: AnnotationExportFailure };

export class AnnotationExportError extends Error {
  constructor(public readonly reason: AnnotationExportFailure) {
    super(`Annotation export: ${reason}`);
    this.name = "AnnotationExportError";
  }
}

export function readAnnotationExportRequest(value: unknown): AnnotationExportRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (Object.keys(request).length !== 2 || !Number.isSafeInteger(request.displayId) ||
      (request.destination !== "file" && request.destination !== "clipboard")) return null;
  return { displayId: request.displayId as number, destination: request.destination };
}

/** Use the physical display scale, never the renderer's current browser zoom. */
export function planAnnotationExport(snapshot: AnnotationDocumentSnapshot, scale: number): AnnotationExportSize {
  const viewport = snapshot.viewport;
  if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) ||
      viewport.width <= 0 || viewport.height <= 0 || !Number.isFinite(scale) || scale <= 0)
    throw new AnnotationExportError("unavailable");
  const width = Math.round(viewport.width * scale);
  const height = Math.round(viewport.height * scale);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > MAX_EXPORT_SIDE || height > MAX_EXPORT_SIDE || width * height > MAX_EXPORT_PIXELS)
    throw new AnnotationExportError("too-large");
  if (!snapshot.elements.length) throw new AnnotationExportError("empty");
  return { width, height };
}

/** Bound allocation BEFORE invoking an image decoder. The decoder still validates the full PNG. */
export function hasExpectedPngHeader(value: unknown, expected: AnnotationExportSize): value is Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength < 33 || value.byteLength > MAX_EXPORT_PNG_BYTES) return false;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => value[index] === byte)) return false;
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  return view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452 &&
    view.getUint32(16) === expected.width && view.getUint32(20) === expected.height;
}

export function annotationExportMessage(reason: AnnotationExportFailure) {
  const messages: Record<AnnotationExportFailure, string> = {
    "invalid-request": "내보내기 요청이 올바르지 않습니다.",
    empty: "선택한 화면에 저장할 확정 판서가 없습니다.",
    "too-large": "이미지가 너무 큽니다. 한 변 8,192px·총 1,677만 픽셀 이내의 화면을 선택하세요.",
    unavailable: "화면을 다시 연결하거나 텍스트 편집을 마친 뒤 내보내세요.",
    busy: "이전 내보내기가 진행 중입니다.",
    timeout: "판서 이미지 생성 시간이 초과됐습니다. 다시 시도하세요.",
    "render-failed": "판서 이미지를 만들지 못했습니다. 파일과 클립보드는 변경하지 않았습니다.",
    "write-failed": "저장 또는 복사에 실패했습니다. PNG 파일 이름·폴더 권한을 확인하고 다시 시도하세요.",
    cancelled: "내보내기를 취소했습니다.",
  };
  return messages[reason];
}
