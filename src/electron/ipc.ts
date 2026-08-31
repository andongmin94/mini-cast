import type { BrowserWindow, WebContents } from "electron";

export function canSendToWebContents(contents: WebContents | null | undefined) {
  return Boolean(contents && !contents.isDestroyed());
}

export function sendToWebContents(
  contents: WebContents | null | undefined,
  channel: string,
  ...args: unknown[]
) {
  if (!canSendToWebContents(contents)) return false;

  try {
    contents!.send(channel, ...args);
    return true;
  } catch {
    return false;
  }
}

export function sendToWindow(
  window: BrowserWindow | null | undefined,
  channel: string,
  ...args: unknown[]
) {
  if (!window || window.isDestroyed()) return false;
  return sendToWebContents(window.webContents, channel, ...args);
}
