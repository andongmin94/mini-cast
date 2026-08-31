import { screen, type Point, type Rectangle } from "electron";
import {
  uIOhook,
  type UiohookKeyboardEvent,
  type UiohookMouseEvent,
} from "uiohook-napi";

import type {
  KeyPress,
  MouseButton,
  MouseButtonEvent,
} from "./contract.js";
import type { OverlayDisplayMeta } from "./display.js";
import {
  buildCombination,
  CombinationDeduplicator,
  getKeyInfo,
  isNonDisplayKey,
} from "./keyboard-input.js";
import { overlayDisplays, overlayWindows } from "./window.js";

const TOOL_SHORTCUTS = new Set([
  "Shift + Alt + 1",
  "Shift + Alt + 3",
  "Shift + Alt + 4",
  "Shift + Alt + 5",
]);
const ACTIVE_ANNOTATION_SHORTCUTS = new Set([
  "Esc",
  "Ctrl + Z",
  "Ctrl + Shift + Z",
  "Shift + Alt + 6",
  "Shift + Alt + 7",
]);

let cursorTimer: ReturnType<typeof setInterval> | undefined;
let inputStarted = false;
let annotationInputActive = false;
const keyDeduplicator = new CombinationDeduplicator();

export function setAnnotationInputMode(active: boolean) {
  annotationInputActive = active;
}

function contains(bounds: Rectangle, point: Point) {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

function findDisplay(point: Point, displays: OverlayDisplayMeta[]) {
  const exact = displays.findIndex((display) => contains(display.bounds, point));
  if (exact >= 0) return exact;

  const nearest = screen.getDisplayNearestPoint(point);
  return displays.findIndex((display) => display.id === nearest.id);
}

function sendToOverlays(channel: string, payload: unknown) {
  overlayWindows.forEach((window) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  });
}

function startCursorCapture() {
  let lastPosition: Point | undefined;
  let lastSentAt = 0;

  cursorTimer = setInterval(() => {
    if (!overlayWindows.length || !overlayDisplays.length) return;

    const position = screen.getCursorScreenPoint();
    const now = Date.now();
    const moved =
      !lastPosition ||
      position.x !== lastPosition.x ||
      position.y !== lastPosition.y;

    if (!moved && now - lastSentAt < 100) return;

    const activeDisplay = findDisplay(position, overlayDisplays);
    overlayWindows.forEach((window, index) => {
      if (window.isDestroyed()) return;
      const display = overlayDisplays[index];
      const local = display
        ? {
            x: Math.round(position.x - display.bounds.x),
            y: Math.round(position.y - display.bounds.y),
          }
        : null;

      window.webContents.send(
        "mouse-move",
        index === activeDisplay && local ? local : null,
      );
    });

    lastPosition = position;
    lastSentAt = now;
  }, 8);
}

function handleKeyDown(event: UiohookKeyboardEvent) {
  if (isNonDisplayKey(event.keycode)) return;

  const key = getKeyInfo(event.keycode);
  if (!key) return;

  const modifiers = {
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
    meta: event.metaKey,
  };
  const combination = buildCombination(key.label, modifiers);
  if (
    TOOL_SHORTCUTS.has(combination) ||
    (annotationInputActive && ACTIVE_ANNOTATION_SHORTCUTS.has(combination))
  ) {
    return;
  }

  const timestamp = Date.now();
  if (!keyDeduplicator.shouldEmit(combination, timestamp)) return;

  overlayWindows.forEach((window, displayId) => {
    if (window.isDestroyed()) return;
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
    const payload: MouseButtonEvent = { button, pressed };
    sendToOverlays("mouse-button", payload);
  }
}

const handleMouseDown = (event: UiohookMouseEvent) =>
  handleMouseButton(event, true);
const handleMouseUp = (event: UiohookMouseEvent) =>
  handleMouseButton(event, false);

export function startInputCapture() {
  if (inputStarted) return;

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
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = undefined;

  if (inputStarted) uIOhook.stop();
  inputStarted = false;

  uIOhook.off("keydown", handleKeyDown);
  uIOhook.off("mousedown", handleMouseDown);
  uIOhook.off("mouseup", handleMouseUp);
}
