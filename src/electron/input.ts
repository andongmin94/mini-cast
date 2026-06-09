import { screen, type Point, type Rectangle } from "electron";
import {
  uIOhook,
  type UiohookKeyboardEvent,
  type UiohookMouseEvent,
} from "uiohook-napi";

import {
  type KeyPress,
  type MouseButton,
  type MouseButtonEvent,
} from "./contract.js";
import { type OverlayDisplayMeta } from "./display.js";
import {
  buildCombination,
  CombinationDeduplicator,
  getKeyInfo,
  isNonDisplayKey,
  type ModifierState,
} from "./keyboard-input.js";
import { overlayDisplays, overlayWindows } from "./window.js";

let cursorTimer: ReturnType<typeof setInterval> | undefined;
let inputStarted = false;
const keyDeduplicator = new CombinationDeduplicator();

function containsPoint(bounds: Rectangle, point: Point) {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

function findDisplayIndex(point: Point, displays: OverlayDisplayMeta[]) {
  const insideIndex = displays.findIndex((display) =>
    containsPoint(display.bounds, point),
  );
  if (insideIndex >= 0) {
    return insideIndex;
  }

  const nearestDisplay = screen.getDisplayNearestPoint(point);
  return displays.findIndex((display) => display.id === nearestDisplay.id);
}

function toLocalPoint(point: Point, display: OverlayDisplayMeta) {
  return {
    x: Math.round(point.x - display.bounds.x),
    y: Math.round(point.y - display.bounds.y),
  };
}

function startCursorCapture() {
  let lastPosition: Point | undefined;
  let lastSentAt = Number.NEGATIVE_INFINITY;

  // 움직일 때는 1ms 단위로 따라가고, 멈춰 있을 때는 100ms마다 상태만 확인합니다.
  cursorTimer = setInterval(() => {
    if (overlayWindows.length === 0 || overlayDisplays.length === 0) {
      return;
    }

    const position = screen.getCursorScreenPoint();
    const now = Date.now();
    const moved =
      !lastPosition ||
      position.x !== lastPosition.x ||
      position.y !== lastPosition.y;

    if (!moved && now - lastSentAt < 100) {
      return;
    }

    const activeDisplayIndex = findDisplayIndex(position, overlayDisplays);

    overlayWindows.forEach((window, index) => {
      const display = overlayDisplays[index];
      const localPosition = display ? toLocalPoint(position, display) : null;
      const isInsideActiveDisplay =
        index === activeDisplayIndex &&
        display &&
        localPosition &&
        containsPoint(
          {
            x: 0,
            y: 0,
            width: display.bounds.width,
            height: display.bounds.height,
          },
          localPosition,
        );

      window.webContents.send(
        "mouse-move",
        isInsideActiveDisplay ? localPosition : null,
      );
    });

    lastPosition = position;
    lastSentAt = now;
  }, 1);
}

function sendToOverlays(channel: string, payload: unknown) {
  overlayWindows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  });
}

function handleKeyDown(event: UiohookKeyboardEvent) {
  if (isNonDisplayKey(event.keycode)) {
    return;
  }

  // 물리 keycode를 사용하므로 한글 IME 상태에서도 실제 누른 QWERTY 키를 얻습니다.
  const key = getKeyInfo(event.keycode);
  if (!key) {
    return;
  }

  const modifiers: ModifierState = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  };
  const combination = buildCombination(key.label, modifiers);
  const timestamp = Date.now();

  if (!keyDeduplicator.shouldEmit(combination, timestamp)) {
    return;
  }

  overlayWindows.forEach((window, displayId) => {
    if (!window.isDestroyed()) {
      const keyPress: KeyPress = {
        key: key.label,
        code: key.code,
        ctrlKey: modifiers.ctrl,
        shiftKey: modifiers.shift,
        altKey: modifiers.alt,
        metaKey: modifiers.meta,
        timestamp,
        displayId,
      };
      window.webContents.send("key-press", keyPress);
    }
  });
}

function handleMouseButton(event: UiohookMouseEvent, pressed: boolean) {
  const button: MouseButton | null =
    event.button === 1
      ? "left"
      : event.button === 2
        ? "right"
        : event.button === 3
          ? "middle"
          : null;

  if (button) {
    const mouseButtonEvent: MouseButtonEvent = { button, pressed };
    sendToOverlays("mouse-button", mouseButtonEvent);
  }
}

const handleMouseDown = (event: UiohookMouseEvent) => {
  handleMouseButton(event, true);
};

const handleMouseUp = (event: UiohookMouseEvent) => {
  handleMouseButton(event, false);
};

export function startInputCapture() {
  if (inputStarted) {
    return;
  }

  startCursorCapture();
  uIOhook.on("keydown", handleKeyDown);
  uIOhook.on("mousedown", handleMouseDown);
  uIOhook.on("mouseup", handleMouseUp);

  try {
    uIOhook.start();
    inputStarted = true;
  } catch (error) {
    stopInputCapture();
    throw error;
  }
}

export function stopInputCapture() {
  if (cursorTimer) {
    clearInterval(cursorTimer);
    cursorTimer = undefined;
  }

  if (inputStarted) {
    uIOhook.stop();
    inputStarted = false;
  }

  uIOhook.off("keydown", handleKeyDown);
  uIOhook.off("mousedown", handleMouseDown);
  uIOhook.off("mouseup", handleMouseUp);
}
