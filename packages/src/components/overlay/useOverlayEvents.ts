import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  type KeyPress,
  type MouseButtons,
  type MousePosition,
  type OverlayViewModel,
} from "@/components/overlay/types";
import { DEFAULT_OVERLAY_SETTINGS } from "@/components/settings/defaults";
import { type OverlaySettings } from "@/components/settings/types";

interface InitEventData {
  id: number;
}

export function useOverlayEvents(): OverlayViewModel {
  const initialDisplayId = (() => {
    const match = getCurrentWindow().label.match(/^overlay-(\d+)$/);
    return match ? Number(match[1]) : 0;
  })();

  const [settings, setSettings] = useState<OverlaySettings>(
    DEFAULT_OVERLAY_SETTINGS,
  );
  const [mousePosition, setMousePosition] = useState<MousePosition | null>(
    null,
  );
  const [keyPresses, setKeyPresses] = useState<KeyPress[]>([]);
  const [displayId, setDisplayId] = useState(initialDisplayId);
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

    nativeBridge.on("update-settings", settingsListener);
    nativeBridge.on("mouse-move", mouseMoveListener);
    nativeBridge.on("key-press", keyPressListener);
    nativeBridge.on("init", initListener);
    nativeBridge.send("overlay-ready");

    return () => {
      nativeBridge.removeListener("update-settings", settingsListener);
      nativeBridge.removeListener("mouse-move", mouseMoveListener);
      nativeBridge.removeListener("key-press", keyPressListener);
      nativeBridge.removeListener("init", initListener);
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

    nativeBridge.on("mouse-left-down", leftDown);
    nativeBridge.on("mouse-left-up", leftUp);
    nativeBridge.on("mouse-middle-down", middleDown);
    nativeBridge.on("mouse-middle-up", middleUp);
    nativeBridge.on("mouse-right-down", rightDown);
    nativeBridge.on("mouse-right-up", rightUp);

    return () => {
      nativeBridge.removeListener("mouse-left-down", leftDown);
      nativeBridge.removeListener("mouse-left-up", leftUp);
      nativeBridge.removeListener("mouse-middle-down", middleDown);
      nativeBridge.removeListener("mouse-middle-up", middleUp);
      nativeBridge.removeListener("mouse-right-down", rightDown);
      nativeBridge.removeListener("mouse-right-up", rightUp);
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
