import type {
  AnnotationDocumentSnapshot,
  AnnotationMutationResult,
  AnnotationStroke,
} from "./annotation/history";
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
} from "./electron/contract";

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
  sendAnnotationCommand(command: AnnotationCommand): void;
  beginAnnotationGesture(gestureId: string): void;
  commitAnnotationStroke(
    gestureId: string,
    stroke: AnnotationStroke,
  ): Promise<AnnotationMutationResult>;
  removeAnnotationStrokes(
    gestureId: string,
    ids: readonly string[],
  ): Promise<AnnotationMutationResult>;
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
    listener: (document: AnnotationDocumentSnapshot) => void,
  ): Unsubscribe;
  onAnnotationGestureCancel(listener: (gestureId: string) => void): Unsubscribe;
}

declare global {
  const miniCast: MiniCastBridge;
}

export {};
