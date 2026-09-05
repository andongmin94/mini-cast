import type { AnnotationTextEditSession, AnnotationTextEditResult } from "../annotation/text-edit";
import type { AnnotationTextReplacement } from "../annotation/text";
import type { AnnotationSelectionEdit } from "../annotation/selection";
import type { AnnotationTextDraft } from "../annotation/text";
import type {
  AnnotationDocumentUpdate,
  AnnotationMutationResult,
} from "../annotation/document-sync";
import type {
  AnnotationDocumentSnapshot,
  AnnotationElement,
} from "../annotation/history";
import type {
  AnnotationCommand,
  AnnotationState,
  AnnotationTool,
  DisplayInfo,
  KeyPress,
  MouseButtonEvent,
  MousePosition,
  OverlayInit,
  OverlaySettings,
  SettingsSaveStatus,
} from "./contract";

type Unsubscribe = () => void;

interface MiniCastBridge {
  minimizeWindow(): void;
  hideWindow(): void;
  requestDisplays(): void;
  saveSettings(settings: OverlaySettings): void;
  notifyOverlayReady(): void;
  getSettings(): Promise<OverlaySettings>;
  getSettingsSaveStatus(): Promise<SettingsSaveStatus>;
  retrySettingsSave(): void;
  acknowledgeSettingsRecovery(): void;
  getAnnotationDocument(): Promise<AnnotationDocumentSnapshot>;
  onSettingsSaveStatus(
    listener: (status: SettingsSaveStatus) => void,
  ): Unsubscribe;
  getAnnotationState(): Promise<AnnotationState>;
  setAnnotationTool(tool: AnnotationTool): void;
  setAnnotationTextDraft(draft: AnnotationTextDraft): Promise<boolean>;
  setAnnotationTextEditing(editing: boolean): void;
  requestAnnotationTextEdit(revision: number, elementId: string): Promise<boolean>;
  getAnnotationTextEdit(): Promise<AnnotationTextEditSession | null>;
  saveAnnotationTextEdit(id: string, value: AnnotationTextReplacement): Promise<AnnotationTextEditResult>;
  cancelAnnotationTextEdit(id: string): void;
  onAnnotationTextEdit(listener: (session: AnnotationTextEditSession | null) => void): Unsubscribe;
  sendAnnotationCommand(command: AnnotationCommand): void;
  beginAnnotationGesture(gestureId: string): void;
  commitAnnotationElement(
    gestureId: string,
    stroke: AnnotationElement,
  ): Promise<AnnotationMutationResult>;
  removeAnnotationElements(
    gestureId: string,
    ids: readonly string[],
  ): Promise<AnnotationMutationResult>;
  editAnnotationSelection(gestureId: string, edit: AnnotationSelectionEdit): Promise<AnnotationMutationResult>;
  endAnnotationGesture(gestureId: string): void;
  onDisplaysUpdated(listener: (displays: DisplayInfo[]) => void): Unsubscribe;
  onSettingsUpdated(listener: (settings: OverlaySettings) => void): Unsubscribe;
  onMouseMove(listener: (position: MousePosition | null) => void): Unsubscribe;
  onMouseButton(listener: (event: MouseButtonEvent) => void): Unsubscribe;
  onKeyPress(listener: (keyPress: KeyPress) => void): Unsubscribe;
  onOverlayInit(listener: (data: OverlayInit) => void): Unsubscribe;
  onAnnotationStateUpdated(
    listener: (state: AnnotationState) => void,
  ): Unsubscribe;
  onAnnotationDocumentUpdated(
    listener: (update: AnnotationDocumentUpdate) => void,
  ): Unsubscribe;
  onAnnotationTransientClear(listener: () => void): Unsubscribe;
  onAnnotationGestureCancel(listener: (gestureId: string) => void): Unsubscribe;
}

declare global {
  const miniCast: MiniCastBridge;
}

export {};
