/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UPDATE_INFO_URL?: string;
  readonly VITE_UPDATE_DOWNLOAD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface NativeBridge {
  send(channel: string, data?: unknown): Promise<unknown>;
  invoke(channel: string, data?: unknown): Promise<unknown>;
  on(channel: string, func: (...args: unknown[]) => void): void;
  get(key: string): Promise<unknown>;
  removeListener(channel: string, func: (...args: unknown[]) => void): void;
}

declare const nativeBridge: NativeBridge;
