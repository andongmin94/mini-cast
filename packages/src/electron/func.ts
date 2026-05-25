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
  rawCursorPoint: Point,
  displays: OverlayDisplayMeta[],
): { cursorPoint: Point; activeDisplayIndex: number } | null {
  const rawByBoundsIndex = getDisplayIndexByBounds(rawCursorPoint, displays);
  if (rawByBoundsIndex >= 0) {
    return { cursorPoint: rawCursorPoint, activeDisplayIndex: rawByBoundsIndex };
  }

  const dipCursorPoint = screen.screenToDipPoint(rawCursorPoint);
  const dipByBoundsIndex = getDisplayIndexByBounds(dipCursorPoint, displays);
  if (dipByBoundsIndex >= 0) {
    return { cursorPoint: dipCursorPoint, activeDisplayIndex: dipByBoundsIndex };
  }

  const rawNearestIndex = getDisplayIndexByNearest(rawCursorPoint, displays);
  if (rawNearestIndex >= 0) {
    const localPoint = toLocalPoint(rawCursorPoint, displays[rawNearestIndex]);
    if (isLocalPointInsideDisplay(localPoint, displays[rawNearestIndex])) {
      return {
        cursorPoint: rawCursorPoint,
        activeDisplayIndex: rawNearestIndex,
      };
    }
  }

  const dipNearestIndex = getDisplayIndexByNearest(dipCursorPoint, displays);
  if (dipNearestIndex >= 0) {
    const localPoint = toLocalPoint(dipCursorPoint, displays[dipNearestIndex]);
    if (isLocalPointInsideDisplay(localPoint, displays[dipNearestIndex])) {
      return {
        cursorPoint: dipCursorPoint,
        activeDisplayIndex: dipNearestIndex,
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

    // Electron cursor coordinates are already DIP values.
    const cursorPosition = screen.getCursorScreenPoint();
    const resolvedCursor = resolveCursorPosition(cursorPosition, overlayDisplays);
    const activeDisplayIndex =
      resolvedCursor?.activeDisplayIndex ??
      getActiveDisplayIndex(cursorPosition, overlayDisplays);
    const effectiveCursorPoint = resolvedCursor?.cursorPoint ?? cursorPosition;

    overlayWindows.forEach((window: any, index: any) => {
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
  const specialKeys: any = {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
  };
  // let capsLockOn = false;
  let lastCombination = "";
  let lastTimestamp = 0;

  const keyNameMap = {
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

  function getKeyName(name: any) {
    if (Object.prototype.hasOwnProperty.call(keyNameMap, name))
      return keyNameMap[name as keyof typeof keyNameMap];
    if (name.length === 1) return name;
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  function sendKeyPress(combination: any, keyDetails: any) {
    const currentTime = Date.now();
    if (combination !== lastCombination || currentTime - lastTimestamp > 200) {
      overlayWindows.forEach((window: any, index: any) => {
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

  gkl.addListener((e) => {
    const rawName = (e.name ?? "").trim();
    if (!rawName) return;

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
      overlayWindows.forEach((window: any) => {
        window.webContents.send(rawName + " " + e.state);
      });
    }

    if (isSpecialKey && rawName !== "CAPS LOCK")
      specialKeys[keyName.toLowerCase()] = e.state === "DOWN";

    if (e.state === "DOWN" && !isSpecialKey) {
      const specialKeyCombination = [];
      if (specialKeys.ctrl) specialKeyCombination.push("Ctrl");
      if (specialKeys.shift) specialKeyCombination.push("Shift");
      if (specialKeys.alt) specialKeyCombination.push("Alt");
      if (specialKeys.meta) specialKeyCombination.push("Meta");

      let combination = keyName;
      if (specialKeyCombination.length > 0)
        combination = `${specialKeyCombination.join(" + ")} + ${keyName}`;

      // // 단일 알파벳 띄우기
      // const keyDetails = {
      //   key: keyName,
      //   code: e.rawKey ? e.rawKey._nameRaw : "",
      //   ctrlKey: specialKeys.ctrl,
      //   shiftKey: specialKeys.shift,
      //   altKey: specialKeys.alt,
      //   metaKey: specialKeys.meta,
      //   timestamp: Date.now(),
      // };
      // sendKeyPress(combination, keyDetails);

      // 단일 알파벳 키인지 확인하는 함수
      function isSingleAlphabet(key: any) {
        return (
          /^[a-zA-Z]$/.test(key) &&
          !specialKeys.ctrl &&
          !specialKeys.shift &&
          !specialKeys.alt &&
          !specialKeys.meta
        );
      }

      // keyDetails 생성 전에 필터링
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
