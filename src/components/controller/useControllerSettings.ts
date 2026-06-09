import { useCallback, useEffect, useState } from "react";

import { DEFAULT_CONTROLLER_SETTINGS } from "@/components/settings/defaults";
import {
  toControllerSettings,
  toOverlaySettings,
} from "@/components/settings/transform";
import {
  type ControllerSettings,
  type Display,
} from "@/components/settings/types";

export function useControllerSettings() {
  const hasNativeBridge = typeof miniCast !== "undefined";
  const [settings, setSettings] = useState<ControllerSettings>(
    DEFAULT_CONTROLLER_SETTINGS,
  );
  const [displays, setDisplays] = useState<Display[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(!hasNativeBridge);

  useEffect(() => {
    if (!hasNativeBridge) {
      return;
    }

    let mounted = true;

    void miniCast
      .getSettings()
      .then((savedSettings) => {
        if (mounted) {
          setSettings(toControllerSettings(savedSettings));
        }
      })
      .catch((error) => {
        console.error("Failed to load settings:", error);
      })
      .finally(() => {
        if (mounted) {
          setSettingsLoaded(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [hasNativeBridge]);

  useEffect(() => {
    if (!hasNativeBridge) {
      return;
    }

    const unsubscribe = miniCast.onDisplaysUpdated(setDisplays);
    miniCast.requestDisplays();
    return unsubscribe;
  }, [hasNativeBridge]);

  useEffect(() => {
    // 저장값을 읽기 전에 기본 설정으로 덮어쓰지 않도록 기다립니다.
    if (hasNativeBridge && settingsLoaded) {
      miniCast.saveSettings(toOverlaySettings(settings));
    }
  }, [hasNativeBridge, settings, settingsLoaded]);

  const setSetting = useCallback(
    <K extends keyof ControllerSettings>(
      key: K,
      value: ControllerSettings[K],
    ) => {
      setSettings((previous) => ({
        ...previous,
        [key]: value,
      }));
    },
    [],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_CONTROLLER_SETTINGS);
  }, []);

  return { settings, displays, setSetting, resetSettings };
}
