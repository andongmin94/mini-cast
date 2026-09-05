import type { AnnotationTextDraft } from "../annotation/text.js";

export type KeyDisplayPosition =
  "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const ANNOTATION_TOOLS = [
  "pass-through",
  "select",
  "pen",
  "highlighter",
  "eraser",
  "line",
  "arrow",
  "rectangle",
  "ellipse",
  "text",
] as const;
export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];

export const ANNOTATION_COMMANDS = ["undo", "redo", "clear"] as const;
export type AnnotationCommand = (typeof ANNOTATION_COMMANDS)[number];

export interface AnnotationState {
  textDraft: AnnotationTextDraft | null;
  tool: AnnotationTool;
  unavailableShortcuts: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface SettingsSaveStatus {
  state: "saved" | "pending" | "failed";
  recovered: boolean;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  name: string;
  bounds: Bounds;
}

export interface AnnotationPreferences {
  annotationShapeFillEnabled: boolean;
  annotationShapeFillColor: string;
  annotationPenColor: string;
  annotationHighlighterColor: string;
  annotationPenWidth: number;
  annotationHighlighterWidth: number;
  annotationEraserWidth: number;
}

export interface OverlaySettings extends AnnotationPreferences {
  cursorFillColor: string;
  cursorStrokeColor: string;
  cursorSize: number;
  cursorStrokeSize: number;
  showCursorHighlight: boolean;
  keyDisplayId: number;
  keyDisplayDuration: number;
  keyDisplayFontSize: number;
  keyDisplayBackgroundColor: string;
  keyDisplayTextColor: string;
  keyDisplayPosition: KeyDisplayPosition;
  showKeyDisplay: boolean;
}

export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  timestamp: number;
  displayId: number;
}

export interface MousePosition {
  x: number;
  y: number;
}

export type MouseButton = "left" | "middle" | "right";

export interface MouseButtonEvent {
  button: MouseButton;
  pressed: boolean;
}

export interface OverlayInit {
  displayId: number;
  width: number;
  height: number;
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  cursorFillColor: "rgba(0, 100, 255, 0.5)",
  cursorStrokeColor: "rgba(32, 38, 50, 0.5)",
  cursorSize: 30,
  cursorStrokeSize: 3,
  showCursorHighlight: true,
  keyDisplayId: 0,
  keyDisplayDuration: 2000,
  keyDisplayFontSize: 16,
  keyDisplayBackgroundColor: "rgba(0, 0, 0, 0.5)",
  keyDisplayTextColor: "#FFFFFF",
  keyDisplayPosition: "bottom-right",
  showKeyDisplay: true,
  annotationShapeFillEnabled: false,
  annotationShapeFillColor: "#FFFFFF",
  annotationPenColor: "#FF3B30",
  annotationHighlighterColor: "#FFD60A",
  annotationPenWidth: 4,
  annotationHighlighterWidth: 18,
  annotationEraserWidth: 28,
};

export function isAnnotationTool(value: unknown): value is AnnotationTool {
  return (
    typeof value === "string" &&
    (ANNOTATION_TOOLS as readonly string[]).includes(value)
  );
}

export function isAnnotationCommand(
  value: unknown,
): value is AnnotationCommand {
  return (
    typeof value === "string" &&
    (ANNOTATION_COMMANDS as readonly string[]).includes(value)
  );
}
