import { useEffect, useRef, useState } from "react";

import { DEFAULT_OVERLAY_SETTINGS } from "@/components/settings/defaults";
import { type OverlaySettings } from "@/components/settings/types";
import {
  type KeyPress,
  type MouseButtons,
  type MousePosition,
  type OverlayViewModel,
} from "@/components/overlay/types";

interface InitEventData {
  id: number;
}

export function useOverlayEvents(): OverlayViewModel {
  const [settings, setSettings] =
    useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS);
  const [mousePosition, setMousePosition] = useState<MousePosition | null>(null);
  const [keyPresses, setKeyPresses] = useState<KeyPress[]>([]);
  const [displayId, setDisplayId] = useState(0);
  const [mouseButtons, setMouseButtons] = useState<MouseButtons>({
    left: false,
    middle: false,
    right: false,
  });

  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const settingsListener = (newSettings: OverlaySettings) => {
      setSettings(newSettings);
    };
    const mouseMoveListener = (position: MousePosition | null) => {
      setMousePosition(position);
    };
    const keyPressListener = (keyPress: KeyPress) => {
      if (
        !settingsRef.current.showKeyDisplay ||
        keyPress.displayId !== settingsRef.current.keyDisplayMonitor
      ) {
        return;
      }

      setKeyPresses((prev) => [...prev, keyPress]);

      window.setTimeout(() => {
        setKeyPresses((current) =>
          current.filter((kp) => kp.timestamp !== keyPress.timestamp),
        );
      }, settingsRef.current.keyDisplayDuration);
    };
    const initListener = (data: InitEventData) => {
      setDisplayId(data.id);
    };

    electron.on("update-settings", settingsListener);
    electron.on("mouse-move", mouseMoveListener);
    electron.on("key-press", keyPressListener);
    electron.on("init", initListener);

    return () => {
      electron.removeListener("update-settings", settingsListener);
      electron.removeListener("mouse-move", mouseMoveListener);
      electron.removeListener("key-press", keyPressListener);
      electron.removeListener("init", initListener);
    };
  }, []);

  useEffect(() => {
    const leftDown = () =>
      setMouseButtons((prev) => ({
        ...prev,
        left: true,
      }));
    const leftUp = () =>
      setMouseButtons((prev) => ({
        ...prev,
        left: false,
      }));
    const middleDown = () =>
      setMouseButtons((prev) => ({
        ...prev,
        middle: true,
      }));
    const middleUp = () =>
      setMouseButtons((prev) => ({
        ...prev,
        middle: false,
      }));
    const rightDown = () =>
      setMouseButtons((prev) => ({
        ...prev,
        right: true,
      }));
    const rightUp = () =>
      setMouseButtons((prev) => ({
        ...prev,
        right: false,
      }));

    electron.on("MOUSE LEFT DOWN", leftDown);
    electron.on("MOUSE LEFT UP", leftUp);
    electron.on("MOUSE MIDDLE DOWN", middleDown);
    electron.on("MOUSE MIDDLE UP", middleUp);
    electron.on("MOUSE RIGHT DOWN", rightDown);
    electron.on("MOUSE RIGHT UP", rightUp);

    return () => {
      electron.removeListener("MOUSE LEFT DOWN", leftDown);
      electron.removeListener("MOUSE LEFT UP", leftUp);
      electron.removeListener("MOUSE MIDDLE DOWN", middleDown);
      electron.removeListener("MOUSE MIDDLE UP", middleUp);
      electron.removeListener("MOUSE RIGHT DOWN", rightDown);
      electron.removeListener("MOUSE RIGHT UP", rightUp);
    };
  }, []);

  return {
    settings,
    mousePosition,
    keyPresses,
    displayId,
    mouseButtons,
  };
}
