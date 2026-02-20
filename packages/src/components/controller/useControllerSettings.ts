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
  const [settings, setSettings] = useState<ControllerSettings>(
    DEFAULT_CONTROLLER_SETTINGS,
  );
  const [displays, setDisplays] = useState<Display[]>([]);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const savedSettings = await nativeBridge.get("settings");
        if (savedSettings) {
          setSettings(toControllerSettings(savedSettings));
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        setSettingsLoaded(true);
      }
    };

    void loadSettings();
  }, []);

  useEffect(() => {
    const handleDisplaysUpdated = (updatedDisplays: Display[]) => {
      setDisplays(updatedDisplays);
    };

    nativeBridge.on("displays-updated", handleDisplaysUpdated);
    nativeBridge.send("request-displays");

    return () => {
      nativeBridge.removeListener("displays-updated", handleDisplaysUpdated);
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    nativeBridge.send("update-settings", toOverlaySettings(settings));
  }, [settings, settingsLoaded]);

  const setSetting = useCallback(
    <K extends keyof ControllerSettings>(
      key: K,
      value: ControllerSettings[K],
    ) => {
      setSettings((prev) => ({
        ...prev,
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
