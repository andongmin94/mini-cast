import { screen, type Point, type Rectangle } from "electron";
import {
  uIOhook,
  type UiohookKeyboardEvent,
  type UiohookMouseEvent,
} from "uiohook-napi";

import { INTERNAL_INPUT_COMBINATIONS } from "./annotation-shortcuts.js";
import type {
  KeyPress,
  MouseButton,
  MouseButtonEvent,
} from "../shared/contract.js";
import type { OverlayDisplayMeta } from "./display.js";
import { sendToWindow } from "./ipc.js";
import {
  buildCombination,
  CombinationDeduplicator,
  getKeyInfo,
  isNonDisplayKey,
} from "./keyboard-input.js";
import { overlayDisplays, overlayWindows } from "./window.js";

let cursorTimer: ReturnType<typeof setInterval> | undefined;
let lastCursorPosition: Point | undefined;
let inputStarted = false;
let annotationInputActive = false;
let fallbackToolCombinations = new Set<string>();
let fallbackToolHandler: ((combination: string) => void) | undefined;
const keyDeduplicator = new CombinationDeduplicator();

export function setAnnotationInputMode(active: boolean) {
  annotationInputActive = active;
}

export function configureToolShortcutFallbacks(
  combinations: Iterable<string>,
  handler: (combination: string) => void,
) {
  fallbackToolCombinations = new Set(combinations);
  fallbackToolHandler = handler;
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
    sendToWindow(window, channel, payload);
  });
}

function publishCursorPosition(force = false) {
  if (!overlayWindows.length || !overlayDisplays.length) return;

  const position = screen.getCursorScreenPoint();
  const moved =
    !lastCursorPosition ||
    position.x !== lastCursorPosition.x ||
    position.y !== lastCursorPosition.y;
  if (!force && !moved) return;

  const activeDisplay = findDisplay(position, overlayDisplays);
  overlayWindows.forEach((window, index) => {
    const display = overlayDisplays[index];
    const local = display
      ? {
          x: Math.round(position.x - display.bounds.x),
          y: Math.round(position.y - display.bounds.y),
        }
      : null;

    sendToWindow(
      window,
      "mouse-move",
      index === activeDisplay && local ? local : null,
    );
  });

  lastCursorPosition = position;
}

function startCursorCapture() {
  publishCursorPosition(true);
  cursorTimer = setInterval(() => publishCursorPosition(), 8);
}

export function refreshCursorCapture() {
  publishCursorPosition(true);
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

  if (fallbackToolCombinations.has(combination)) {
    fallbackToolHandler?.(combination);
  }
  if (
    INTERNAL_INPUT_COMBINATIONS.has(combination) &&
    (annotationInputActive || combination.includes("Alt"))
  ) {
    return;
  }

  const timestamp = Date.now();
  if (!keyDeduplicator.shouldEmit(combination, timestamp)) return;

  overlayWindows.forEach((window, index) => {
    const displayId = overlayDisplays[index]?.id;
    if (displayId === undefined) return;

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
    sendToWindow(window, "key-press", keyPress);
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
  lastCursorPosition = undefined;

  if (inputStarted) uIOhook.stop();
  inputStarted = false;

  uIOhook.off("keydown", handleKeyDown);
  uIOhook.off("mousedown", handleMouseDown);
  uIOhook.off("mouseup", handleMouseUp);
}
