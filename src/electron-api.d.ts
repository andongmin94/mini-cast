import type {
  KeyPress,
  MouseButtonEvent,
  MousePosition,
} from "@/electron/contract";

import type { Display, OverlaySettings } from "@/components/settings/types";

interface OverlayInit {
  id: number;
  width: number;
  height: number;
}

interface RuntimeInfo {
  installMode: "portable" | "msi" | "unknown";
  platform: string;
  arch: string;
}

type Unsubscribe = () => void;

interface MiniCastBridge {
  minimizeWindow(): void;
  hideWindow(): void;
  requestDisplays(): void;
  saveSettings(settings: OverlaySettings): void;
  notifyOverlayReady(): void;

  getSettings(): Promise<OverlaySettings>;
  getRuntimeInfo(): Promise<RuntimeInfo>;

  onDisplaysUpdated(listener: (displays: Display[]) => void): Unsubscribe;
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
