import Store from "electron-store";

import { DEFAULT_OVERLAY_SETTINGS, type OverlaySettings } from "./contract.js";

interface SettingsSchema {
  settings: OverlaySettings;
}

export type SettingsStore = Store<SettingsSchema>;

export function createSettingsStore(): SettingsStore {
  return new Store<SettingsSchema>({
    defaults: {
      settings: DEFAULT_OVERLAY_SETTINGS,
    },
  });
}
