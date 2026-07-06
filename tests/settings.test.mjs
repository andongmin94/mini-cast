import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_OVERLAY_SETTINGS } from "../dist/electron/contract.js";
import {
  normalizeOverlaySettings,
  overlaySettingsEqual,
} from "../dist/electron/settings.js";

test("valid settings are preserved", () => {
  const settings = {
    ...DEFAULT_OVERLAY_SETTINGS,
    cursorSize: 42,
    keyDisplayMonitor: 1,
    keyDisplayPosition: "top-left",
  };

  assert.deepEqual(normalizeOverlaySettings(settings, 2), settings);
  assert.equal(overlaySettingsEqual(settings, settings), true);
});

test("partial and malformed settings fall back to current defaults", () => {
  const settings = normalizeOverlaySettings(
    {
      cursorFillColor: "",
      cursorStrokeColor: null,
      cursorSize: Number.NaN,
      showCursorHighlight: "false",
      keyDisplayPosition: "center",
      showKeyDisplay: false,
    },
    1,
  );

  assert.equal(
    settings.cursorFillColor,
    DEFAULT_OVERLAY_SETTINGS.cursorFillColor,
  );
  assert.equal(
    settings.cursorStrokeColor,
    DEFAULT_OVERLAY_SETTINGS.cursorStrokeColor,
  );
  assert.equal(settings.cursorSize, DEFAULT_OVERLAY_SETTINGS.cursorSize);
  assert.equal(
    settings.showCursorHighlight,
    DEFAULT_OVERLAY_SETTINGS.showCursorHighlight,
  );
  assert.equal(
    settings.keyDisplayPosition,
    DEFAULT_OVERLAY_SETTINGS.keyDisplayPosition,
  );
  assert.equal(settings.showKeyDisplay, false);
});

test("numeric settings and monitor selection are clamped", () => {
  const settings = normalizeOverlaySettings(
    {
      cursorSize: 999,
      cursorStrokeSize: -10,
      keyDisplayMonitor: 9,
      keyDisplayDuration: 1,
      keyDisplayFontSize: 80,
    },
    2,
  );

  assert.equal(settings.cursorSize, 60);
  assert.equal(settings.cursorStrokeSize, 0);
  assert.equal(settings.keyDisplayMonitor, 1);
  assert.equal(settings.keyDisplayDuration, 500);
  assert.equal(settings.keyDisplayFontSize, 60);
});

test("settings equality rejects incomplete runtime data", () => {
  assert.equal(
    overlaySettingsEqual(
      { cursorSize: DEFAULT_OVERLAY_SETTINGS.cursorSize },
      DEFAULT_OVERLAY_SETTINGS,
    ),
    false,
  );
});
