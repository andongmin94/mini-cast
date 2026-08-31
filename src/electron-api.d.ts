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
} from "./electron/contract";

type Unsubscribe = () => void;

interface MiniCastBridge {
  minimizeWindow(): void;
  hideWindow(): void;
  requestDisplays(): void;
  saveSettings(settings: OverlaySettings): void;
  notifyOverlayReady(): void;
  getSettings(): Promise<OverlaySettings>;
  getAnnotationState(): Promise<AnnotationState>;
  setAnnotationTool(tool: AnnotationTool): void;
  sendAnnotationCommand(command: AnnotationCommand): void;
  notifyAnnotationInteraction(): void;
  onDisplaysUpdated(listener: (displays: DisplayInfo[]) => void): Unsubscribe;
  onSettingsUpdated(listener: (settings: OverlaySettings) => void): Unsubscribe;
  onMouseMove(listener: (position: MousePosition | null) => void): Unsubscribe;
  onMouseButton(listener: (event: MouseButtonEvent) => void): Unsubscribe;
  onKeyPress(listener: (keyPress: KeyPress) => void): Unsubscribe;
  onOverlayInit(listener: (data: OverlayInit) => void): Unsubscribe;
  onAnnotationStateUpdated(
    listener: (state: AnnotationState) => void,
  ): Unsubscribe;
  onAnnotationCommand(listener: (command: AnnotationCommand) => void): Unsubscribe;
}

declare global {
  const miniCast: MiniCastBridge;
}

export {};
