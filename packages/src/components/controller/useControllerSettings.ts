import { useCallback, useEffect, useState } from "react";

import { DEFAULT_CONTROLLER_SETTINGS } from "@/components/settings/defaults";
import {
  type ControllerSettings,
  type Display,
} from "@/components/settings/types";
import {
  toControllerSettings,
  toOverlaySettings,
} from "@/components/settings/transform";

export function useControllerSettings() {
  const [settings, setSettings] = useState<ControllerSettings>(
    DEFAULT_CONTROLLER_SETTINGS,
  );
  const [displays, setDisplays] = useState<Display[]>([]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const savedSettings = await electron.get("settings");
        if (savedSettings) {
          setSettings(toControllerSettings(savedSettings));
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
      }
    };

    void loadSettings();
  }, []);

  useEffect(() => {
    const handleDisplaysUpdated = (updatedDisplays: Display[]) => {
      setDisplays(updatedDisplays);
    };

    electron.on("displays-updated", handleDisplaysUpdated);
    electron.send("request-displays");

    return () => {
      electron.removeListener("displays-updated", handleDisplaysUpdated);
    };
  }, []);

  useEffect(() => {
    electron.send("update-settings", toOverlaySettings(settings));
  }, [settings]);

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
