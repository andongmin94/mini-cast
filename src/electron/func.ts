import { screen, type Point, type Rectangle } from "electron";
import { GlobalKeyboardListener } from "node-global-key-listener";
import { getOrderedDisplays, type OverlayDisplayMeta } from "./display.js";
import { overlayDisplays, overlayWindows } from "./window.js";

export let mouseEventInterval: any;

function isPointInsideBounds(point: Point, bounds: Rectangle) {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

function getDisplayIndexByBounds(
  cursorPoint: Point,
  displays: OverlayDisplayMeta[],
) {
  return displays.findIndex((display) =>
    isPointInsideBounds(cursorPoint, display.bounds),
  );
}

function getDisplayIndexByNearest(
  cursorPoint: Point,
  displays: OverlayDisplayMeta[],
) {
  const nearestDisplay = screen.getDisplayNearestPoint(cursorPoint);
  return displays.findIndex((display) => display.id === nearestDisplay.id);
}

function isLocalPointInsideDisplay(
  localPoint: { x: number; y: number },
  display: OverlayDisplayMeta,
) {
  return (
    localPoint.x >= 0 &&
    localPoint.x < display.bounds.width &&
    localPoint.y >= 0 &&
    localPoint.y < display.bounds.height
  );
}

function toLocalPoint(cursorPoint: Point, display: OverlayDisplayMeta) {
  return {
    x: Math.round(cursorPoint.x - display.bounds.x),
    y: Math.round(cursorPoint.y - display.bounds.y),
  };
}

function resolveCursorPosition(
  cursorPoint: Point,
  displays: OverlayDisplayMeta[],
): { cursorPoint: Point; activeDisplayIndex: number } | null {
  const byBoundsIndex = getDisplayIndexByBounds(cursorPoint, displays);
  if (byBoundsIndex >= 0) {
    return {
      cursorPoint,
      activeDisplayIndex: byBoundsIndex,
    };
  }

  const nearestIndex = getDisplayIndexByNearest(cursorPoint, displays);
  if (nearestIndex >= 0) {
    const localPoint = toLocalPoint(cursorPoint, displays[nearestIndex]);
    if (isLocalPointInsideDisplay(localPoint, displays[nearestIndex])) {
      return {
        cursorPoint,
        activeDisplayIndex: nearestIndex,
      };
    }
  }

  return null;
}

function getActiveDisplayIndex(
  cursorPoint: Point,
  displays: OverlayDisplayMeta[],
) {
  const byBoundsIndex = getDisplayIndexByBounds(cursorPoint, displays);
  if (byBoundsIndex >= 0) {
    return byBoundsIndex;
  }

  return getDisplayIndexByNearest(cursorPoint, displays);
}

export function captureMouseEvents() {
  mouseEventInterval = setInterval(() => {
    if (overlayWindows.length === 0 || overlayDisplays.length === 0) {
      return;
    }

    const cursorPosition = screen.getCursorScreenPoint();
    const resolvedCursor = resolveCursorPosition(cursorPosition, overlayDisplays);
    const activeDisplayIndex =
      resolvedCursor?.activeDisplayIndex ??
      getActiveDisplayIndex(cursorPosition, overlayDisplays);
    const effectiveCursorPoint = resolvedCursor?.cursorPoint ?? cursorPosition;

    overlayWindows.forEach((window, index) => {
      const display = overlayDisplays[index];

      if (!display || index !== activeDisplayIndex) {
        window.webContents.send("mouse-move", null);
        return;
      }

      const localPosition = toLocalPoint(effectiveCursorPoint, display);

      if (!isLocalPointInsideDisplay(localPosition, display)) {
        window.webContents.send("mouse-move", null);
        return;
      }

      window.webContents.send("mouse-move", localPosition);
    });
  }, 8);
}

export function captureKeyboardEvents() {
  const gkl = new GlobalKeyboardListener();

  const specialKeys: Record<string, boolean> = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };

  let lastCombination = "";
  let lastTimestamp = 0;

  const keyNameMap: Record<string, string> = {
    "LEFT CTRL": "Ctrl",
    "RIGHT CTRL": "Ctrl",
    "LEFT SHIFT": "Shift",
    "RIGHT SHIFT": "Shift",
    "LEFT ALT": "Alt",
    "RIGHT ALT": "Alt",
    "LEFT META": "Meta",
    "RIGHT META": "Meta",
    ESCAPE: "Esc",
    RETURN: "Enter",
    "BACK SPACE": "Backspace",
    "CAPS LOCK": "CapsLock",
    SPACE: "Space",
    TAB: "Tab",
    "UP ARROW": "↑",
    "DOWN ARROW": "↓",
    "LEFT ARROW": "←",
    "RIGHT ARROW": "→",
    PERIOD: ".",
    COMMA: ",",
    SEMICOLON: ";",
    "FORWARD SLASH": "/",
    "BACK SLASH": "\\",
    EQUAL: "=",
    MINUS: "-",
    "OPEN BRACKET": "[",
    "CLOSE BRACKET": "]",
    QUOTE: "'",
    "BACK QUOTE": "`",
  };

  function getKeyName(name: string) {
    if (Object.prototype.hasOwnProperty.call(keyNameMap, name)) {
      return keyNameMap[name];
    }

    if (name.length === 1) {
      return name;
    }

    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  function sendKeyPress(combination: string, keyDetails: Record<string, unknown>) {
    const currentTime = Date.now();

    if (combination !== lastCombination || currentTime - lastTimestamp > 200) {
      overlayWindows.forEach((window, index) => {
        window.webContents.send("key-press", {
          ...keyDetails,
          displayId: index,
          combination,
        });
      });

      lastCombination = combination;
      lastTimestamp = currentTime;
    }
  }

  function isSingleAlphabet(key: string) {
    return (
      /^[a-zA-Z]$/.test(key) &&
      !specialKeys.ctrl &&
      !specialKeys.shift &&
      !specialKeys.alt &&
      !specialKeys.meta
    );
  }

  gkl.addListener((e) => {
    const rawName = (e.name ?? "").trim();
    if (!rawName) {
      return;
    }

    const isSpecialKey = [
      "LEFT CTRL",
      "RIGHT CTRL",
      "LEFT SHIFT",
      "RIGHT SHIFT",
      "LEFT ALT",
      "RIGHT ALT",
      "LEFT META",
      "RIGHT META",
      "CAPS LOCK",
    ].includes(rawName);

    const keyName = getKeyName(rawName);

    if (
      rawName === "MOUSE LEFT" ||
      rawName === "MOUSE MIDDLE" ||
      rawName === "MOUSE RIGHT"
    ) {
      overlayWindows.forEach((window) => {
        window.webContents.send(`${rawName} ${e.state}`);
      });
    }

    if (isSpecialKey && rawName !== "CAPS LOCK") {
      specialKeys[keyName.toLowerCase()] = e.state === "DOWN";
    }

    if (e.state === "DOWN" && !isSpecialKey) {
      const specialKeyCombination: string[] = [];

      if (specialKeys.ctrl) specialKeyCombination.push("Ctrl");
      if (specialKeys.shift) specialKeyCombination.push("Shift");
      if (specialKeys.alt) specialKeyCombination.push("Alt");
      if (specialKeys.meta) specialKeyCombination.push("Meta");

      let combination = keyName;
      if (specialKeyCombination.length > 0) {
        combination = `${specialKeyCombination.join(" + ")} + ${keyName}`;
      }

      if (!isSingleAlphabet(keyName)) {
        const keyDetails = {
          key: keyName,
          code: e.rawKey ? e.rawKey._nameRaw : "",
          ctrlKey: specialKeys.ctrl,
          shiftKey: specialKeys.shift,
          altKey: specialKeys.alt,
          metaKey: specialKeys.meta,
          timestamp: Date.now(),
        };

        sendKeyPress(combination, keyDetails);
      }
    }
  });
}

export function getConnectedDisplays() {
  return getOrderedDisplays().map((display, index) => ({
    id: display.id,
    name: `모니터 ${index + 1}`,
    bounds: display.bounds,
  }));
}