import Store from "electron-store";

import { DEFAULT_OVERLAY_SETTINGS, type OverlaySettings } from "./contract.js";

/** Let electron-store handle atomic writes and invalid JSON recovery. */
export function openSettingsStore() {
  let recovered = false;
  const store = new Store<{ settings: OverlaySettings }>({
    defaults: { settings: DEFAULT_OVERLAY_SETTINGS },
    clearInvalidConfig: true,
    deserialize(text) {
      try {
        return JSON.parse(text);
      } catch (error) {
        if (error instanceof SyntaxError) recovered = true;
        throw error;
      }
    },
  });
  return { store, recovered };
}
