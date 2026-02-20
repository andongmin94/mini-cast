import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

type Listener = (...args: unknown[]) => void;
type UnlistenFn = () => void;

const listeners = new Map<string, Set<Listener>>();
const subscriptions = new Map<string, Promise<UnlistenFn>>();
const currentWindow = getCurrentWebviewWindow();

async function ensureSubscription(channel: string) {
  if (subscriptions.has(channel)) {
    return;
  }

  const unlisten = currentWindow.listen(channel, (event) => {
    const callbacks = listeners.get(channel);
    if (!callbacks || callbacks.size === 0) {
      return;
    }

    callbacks.forEach((callback) => {
      callback(event.payload);
    });
  });

  subscriptions.set(channel, unlisten);
}

async function cleanupSubscription(channel: string) {
  if (listeners.get(channel)?.size) {
    return;
  }

  const unlisten = subscriptions.get(channel);
  if (!unlisten) {
    return;
  }

  subscriptions.delete(channel);
  const stop = await unlisten;
  stop();
}

const nativeBridge = {
  send(channel: string, data?: unknown) {
    switch (channel) {
      case "minimize":
        return invoke("minimize_main");
      case "hidden":
        return invoke("hide_main");
      case "request-displays":
        return invoke("request_displays");
      case "update-settings":
        return invoke("update_settings", { settings: data });
      case "overlay-ready":
        return invoke("overlay_ready");
      default:
        return Promise.resolve(null);
    }
  },
  invoke(channel: string, data?: unknown) {
    return invoke(channel, { payload: data });
  },
  on(channel: string, func: Listener) {
    const callbackSet = listeners.get(channel) ?? new Set<Listener>();
    callbackSet.add(func);
    listeners.set(channel, callbackSet);
    void ensureSubscription(channel);
  },
  get(key: string) {
    return invoke("get_value", { key });
  },
  removeListener(channel: string, func: Listener) {
    const callbackSet = listeners.get(channel);
    if (!callbackSet) {
      return;
    }

    callbackSet.delete(func);
    if (callbackSet.size === 0) {
      listeners.delete(channel);
      void cleanupSubscription(channel);
    }
  },
};

(globalThis as Record<string, unknown>).nativeBridge = nativeBridge;

export {};
