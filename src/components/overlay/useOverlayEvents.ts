import { useEffect, useRef, useState } from "react";
import { type MouseButtonEvent } from "@/electron/contract";

import {
  type KeyPress,
  type MouseButtons,
  type MousePosition,
  type OverlayViewModel,
} from "@/components/overlay/types";
import { DEFAULT_OVERLAY_SETTINGS } from "@/components/settings/defaults";

interface OverlayInit {
  id: number;
  width: number;
  height: number;
}

interface CoordinateSpace {
  sourceWidth: number;
  sourceHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function useOverlayEvents(): OverlayViewModel {
  const [settings, setSettings] = useState(DEFAULT_OVERLAY_SETTINGS);
  const [mousePosition, setMousePosition] = useState<MousePosition | null>(
    null,
  );
  const [keyPresses, setKeyPresses] = useState<KeyPress[]>([]);
  const [displayId, setDisplayId] = useState(0);
  const [mouseButtons, setMouseButtons] = useState<MouseButtons>({
    left: false,
    middle: false,
    right: false,
  });

  const settingsRef = useRef(settings);
  const coordinateSpace = useRef<CoordinateSpace>({
    sourceWidth: window.innerWidth,
    sourceHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (typeof miniCast === "undefined") {
      return;
    }

    const syncViewport = () => {
      coordinateSpace.current.viewportWidth = window.innerWidth;
      coordinateSpace.current.viewportHeight = window.innerHeight;
    };

    const normalizeMousePosition = (position: MousePosition) => {
      const { sourceWidth, sourceHeight, viewportWidth, viewportHeight } =
        coordinateSpace.current;

      if (sourceWidth <= 0 || sourceHeight <= 0) {
        return position;
      }

      return {
        x: Math.max(
          0,
          Math.min(
            viewportWidth - 1,
            Math.round(position.x * (viewportWidth / sourceWidth)),
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            viewportHeight - 1,
            Math.round(position.y * (viewportHeight / sourceHeight)),
          ),
        ),
      };
    };

    const onMouseMove = (position: MousePosition | null) => {
      setMousePosition(position ? normalizeMousePosition(position) : null);
    };

    const onMouseButton = ({ button, pressed }: MouseButtonEvent) => {
      setMouseButtons((previous) => ({
        ...previous,
        [button]: pressed,
      }));
    };

    const onKeyPress = (keyPress: KeyPress) => {
      const currentSettings = settingsRef.current;
      if (
        !currentSettings.showKeyDisplay ||
        keyPress.displayId !== currentSettings.keyDisplayMonitor
      ) {
        return;
      }

      setKeyPresses((previous) => [...previous, keyPress]);
      window.setTimeout(() => {
        setKeyPresses((current) =>
          current.filter((item) => item.timestamp !== keyPress.timestamp),
        );
      }, currentSettings.keyDisplayDuration);
    };

    const onOverlayInit = (data: OverlayInit) => {
      setDisplayId(data.id);
      coordinateSpace.current = {
        sourceWidth: data.width || window.innerWidth,
        sourceHeight: data.height || window.innerHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    };

    window.addEventListener("resize", syncViewport);
    const unsubscribe = [
      miniCast.onSettingsUpdated(setSettings),
      miniCast.onMouseMove(onMouseMove),
      miniCast.onMouseButton(onMouseButton),
      miniCast.onKeyPress(onKeyPress),
      miniCast.onOverlayInit(onOverlayInit),
    ];

    // 리스너가 준비된 뒤 main process에 초기 설정을 요청합니다.
    miniCast.notifyOverlayReady();

    return () => {
      window.removeEventListener("resize", syncViewport);
      unsubscribe.forEach((cleanup) => cleanup());
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
