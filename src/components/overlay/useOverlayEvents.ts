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
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor?: number;
}

interface OverlayCoordinateSpace {
  sourceWidth: number;
  sourceHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function useOverlayEvents(): OverlayViewModel {
  const [settings, setSettings] = useState(DEFAULT_OVERLAY_SETTINGS);
  const [mousePosition, setMousePosition] = useState<MousePosition | null>(null);
  const [keyPresses, setKeyPresses] = useState<KeyPress[]>([]);
  const [displayId, setDisplayId] = useState(0);
  const [mouseButtons, setMouseButtons] = useState<MouseButtons>({
    left: false,
    middle: false,
    right: false,
  });

  const settingsRef = useRef(settings);
  const coordinateSpaceRef = useRef<OverlayCoordinateSpace>({
    sourceWidth: window.innerWidth,
    sourceHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const syncViewport = () => {
      coordinateSpaceRef.current = {
        ...coordinateSpaceRef.current,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    };

    const normalizeMousePosition = (position: MousePosition): MousePosition => {
      const {
        sourceWidth,
        sourceHeight,
        viewportWidth,
        viewportHeight,
      } = coordinateSpaceRef.current;

      if (
        sourceWidth <= 0 ||
        sourceHeight <= 0 ||
        viewportWidth <= 0 ||
        viewportHeight <= 0
      ) {
        return position;
      }

      const normalizedX = Math.round(position.x * (viewportWidth / sourceWidth));
      const normalizedY = Math.round(position.y * (viewportHeight / sourceHeight));

      return {
        x: Math.max(0, Math.min(viewportWidth - 1, normalizedX)),
        y: Math.max(0, Math.min(viewportHeight - 1, normalizedY)),
      };
    };

    const settingsListener = (newSettings: OverlaySettings) => {
      setSettings(newSettings);
    };

    const mouseMoveListener = (position: MousePosition | null) => {
      setMousePosition(position ? normalizeMousePosition(position) : null);
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

      coordinateSpaceRef.current = {
        sourceWidth: data.width || window.innerWidth,
        sourceHeight: data.height || window.innerHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    };

    const handleResize = () => {
      syncViewport();
    };

    syncViewport();
    window.addEventListener("resize", handleResize);

    electron.on("update-settings", settingsListener);
    electron.on("mouse-move", mouseMoveListener);
    electron.on("key-press", keyPressListener);
    electron.on("init", initListener);

    return () => {
      window.removeEventListener("resize", handleResize);

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