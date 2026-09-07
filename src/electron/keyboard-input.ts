import { UiohookKey } from "uiohook-napi";

export const COMBINATION_DEDUP_MS = 5;

export interface ModifierState {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export interface KeyInfo {
  label: string;
  code: string;
}

const NON_DISPLAY_KEYS = new Set<number>([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight,
  UiohookKey.CapsLock,
]);

const LABEL_OVERRIDES: Record<string, string> = {
  Escape: "Esc",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowRight: "→",
  ArrowDown: "↓",
  NumpadMultiply: "*",
  NumpadAdd: "+",
  NumpadSubtract: "-",
  NumpadDecimal: ".",
  NumpadDivide: "/",
  NumpadEnter: "Enter",
  NumpadEnd: "1",
  NumpadArrowDown: "2",
  NumpadPageDown: "3",
  NumpadArrowLeft: "4",
  NumpadArrowRight: "6",
  NumpadHome: "7",
  NumpadArrowUp: "8",
  NumpadPageUp: "9",
  NumpadInsert: "0",
  NumpadDelete: ".",
  Semicolon: ";",
  Equal: "=",
  Comma: ",",
  Minus: "-",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  BracketLeft: "[",
  Backslash: "\\",
  BracketRight: "]",
  Quote: "'",
};

const KEY_INFO = new Map<number, KeyInfo>();

Object.entries(UiohookKey).forEach(([code, keycode]) => {
  if (typeof keycode === "number") {
    KEY_INFO.set(keycode, {
      label: LABEL_OVERRIDES[code] ?? code,
      code,
    });
  }
});

const EXTRA_KEYS: Array<[number, KeyInfo]> = [
  [0x0070, { label: "한/영", code: "HangulMode" }],
  [0x0079, { label: "한자", code: "Hanja" }],
  [0x007b, { label: "Hiragana", code: "Hiragana" }],
  [0xe020, { label: "음소거", code: "VolumeMute" }],
  [0xe030, { label: "볼륨 +", code: "VolumeUp" }],
  [0xe02e, { label: "볼륨 -", code: "VolumeDown" }],
  [0xe022, { label: "재생", code: "MediaPlay" }],
  [0xe024, { label: "정지", code: "MediaStop" }],
  [0xe010, { label: "이전", code: "MediaPrevious" }],
  [0xe019, { label: "다음", code: "MediaNext" }],
];

EXTRA_KEYS.forEach(([keycode, info]) => KEY_INFO.set(keycode, info));

export function isNonDisplayKey(keycode: number) {
  return NON_DISPLAY_KEYS.has(keycode);
}

export function getKeyInfo(keycode: number) {
  return KEY_INFO.get(keycode) ?? null;
}

export function buildCombination(label: string, modifiers: ModifierState) {
  const keys: string[] = [];
  if (modifiers.ctrl) keys.push("Ctrl");
  if (modifiers.shift) keys.push("Shift");
  if (modifiers.alt) keys.push("Alt");
  if (modifiers.meta) keys.push("Meta");
  keys.push(label);
  return keys.join(" + ");
}

export class CombinationDeduplicator {
  private lastCombination = "";
  private lastTimestamp = Number.NEGATIVE_INFINITY;

  shouldEmit(combination: string, timestamp: number) {
    const elapsed = timestamp - this.lastTimestamp;
    const duplicate =
      combination === this.lastCombination &&
      elapsed >= 0 &&
      elapsed <= COMBINATION_DEDUP_MS;

    if (duplicate) return false;
    this.lastCombination = combination;
    this.lastTimestamp = timestamp;
    return true;
  }
}
