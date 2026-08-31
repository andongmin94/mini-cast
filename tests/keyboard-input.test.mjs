import assert from "node:assert/strict";
import test from "node:test";
import { UiohookKey } from "uiohook-napi";

import {
  buildCombination,
  CombinationDeduplicator,
  getKeyInfo,
} from "../dist/electron/keyboard-input.js";

test("plain alphabet keys remain displayable", () => {
  const modifiers = { ctrl: false, shift: false, alt: false, meta: false };

  assert.equal(getKeyInfo(UiohookKey.A)?.label, "A");
  assert.equal(buildCombination("A", modifiers), "A");
});

test("modifier combinations use Ctrl, Shift, Alt, Meta order", () => {
  const modifiers = {
    meta: true,
    alt: true,
    shift: true,
    ctrl: true,
  };

  assert.equal(
    buildCombination("K", modifiers),
    "Ctrl + Shift + Alt + Meta + K",
  );
});

test("only identical events within five milliseconds are deduplicated", () => {
  const deduplicator = new CombinationDeduplicator();

  assert.equal(deduplicator.shouldEmit("A", 100), true);
  assert.equal(deduplicator.shouldEmit("A", 105), false);
  assert.equal(deduplicator.shouldEmit("A", 106), true);
  assert.equal(deduplicator.shouldEmit("B", 106), true);
});

test("library key names normalize to compact Tauri-equivalent labels", () => {
  assert.equal(getKeyInfo(UiohookKey[1])?.label, "1");
  assert.equal(getKeyInfo(UiohookKey.Equal)?.label, "=");
  assert.equal(getKeyInfo(UiohookKey.Period)?.label, ".");
  assert.equal(getKeyInfo(UiohookKey.Backslash)?.label, "\\");
  assert.equal(getKeyInfo(UiohookKey.BracketLeft)?.label, "[");
  assert.equal(getKeyInfo(UiohookKey.NumpadAdd)?.label, "+");
  assert.equal(getKeyInfo(UiohookKey.NumpadEnter)?.label, "Enter");
  assert.equal(getKeyInfo(0x0070)?.label, "한/영");
  assert.equal(getKeyInfo(0x0079)?.label, "한자");
});
