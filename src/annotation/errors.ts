export type AnnotationFailureReason =
  | "invalid-element"
  | "duplicate-element"
  | "element-limit"
  | "point-limit"
  | "stale-gesture"
  | "stale-document"
  | "no-change"
  | "unavailable"
  | "internal";

const DOMAIN_MESSAGES = {
  "unavailable": "Annotation editing is currently unavailable",
  "stale-gesture": "Annotation edit session expired or was cancelled",
  "stale-document": "Annotation document changed during editing",
  "invalid-element": "Invalid annotation element",
  "duplicate-element": "Duplicate annotation element id",
  "element-limit": "Annotation element limit reached",
  "point-limit": "Annotation point limit reached",
} as const;

export class AnnotationError extends Error {
  constructor(readonly reason: keyof typeof DOMAIN_MESSAGES) {
    super(DOMAIN_MESSAGES[reason]);
    this.name = "AnnotationError";
  }
}

export function annotationFailureMessage(reason: AnnotationFailureReason) {
  switch (reason) {
    case "stale-document":
      return "판서가 변경되어 이전 선택으로 편집하지 않았습니다. 객체를 다시 선택해 주세요.";
    case "element-limit":
    case "point-limit":
      return "이 화면의 판서 용량 한도에 도달해 새 판서를 저장하지 못했습니다. 기존 판서를 지운 뒤 다시 그려 주세요.";
    case "unavailable":
      return "화면을 다시 연결하는 중이라 판서를 저장하지 못했습니다. 화면이 준비되면 다시 그려 주세요.";
    case "invalid-element":
    case "duplicate-element":
    case "internal":
      return "판서를 저장하지 못했습니다. 기존 판서는 유지됩니다. 다시 시도해 주세요.";
    case "stale-gesture":
    case "no-change":
      return null;
  }
}
