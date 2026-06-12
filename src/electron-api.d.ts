import type {
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
  onDisplaysUpdated(listener: (displays: DisplayInfo[]) => void): Unsubscribe;
  onSettingsUpdated(listener: (settings: OverlaySettings) => void): Unsubscribe;
  onMouseMove(listener: (position: MousePosition | null) => void): Unsubscribe;
  onMouseButton(listener: (event: MouseButtonEvent) => void): Unsubscribe;
  onKeyPress(listener: (keyPress: KeyPress) => void): Unsubscribe;
  onOverlayInit(listener: (data: OverlayInit) => void): Unsubscribe;
}

declare global {
  const miniCast: MiniCastBridge;
}

export {};
