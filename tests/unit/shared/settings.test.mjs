import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_OVERLAY_SETTINGS } from "../../../dist/shared/contract.js";
import {
  normalizeOverlaySettings,
  overlaySettingsEqual,
} from "../../../dist/shared/settings.js";

test("valid settings are preserved", () => {
  const settings = {
    ...DEFAULT_OVERLAY_SETTINGS,
    cursorSize: 42,
    keyDisplayId: 202,
    keyDisplayPosition: "top-left",
    annotationPenWidth: 9,
  };

  assert.deepEqual(normalizeOverlaySettings(settings, [101, 202]), settings);
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
      annotationPenColor: "red",
    },
    [101],
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
  assert.equal(
    settings.annotationPenColor,
    DEFAULT_OVERLAY_SETTINGS.annotationPenColor,
  );
  assert.equal(settings.keyDisplayId, 101);
});

test("legacy color forms are migrated without losing their visual values", () => {
  const settings = normalizeOverlaySettings(
    {
      ...DEFAULT_OVERLAY_SETTINGS,
      cursorFillColor: "#0064FF",
      cursorStrokeColor: "rgb(32, 38, 50)",
      keyDisplayBackgroundColor: "#00000080",
      keyDisplayTextColor: "rgb(255, 255, 255)",
    },
    [10],
  );

  assert.equal(settings.cursorFillColor, "rgba(0, 100, 255, 1)");
  assert.equal(settings.cursorStrokeColor, "rgba(32, 38, 50, 1)");
  assert.equal(settings.keyDisplayBackgroundColor, "rgba(0, 0, 0, 0.502)");
  assert.equal(settings.keyDisplayTextColor, "#FFFFFF");
});

test("numeric settings and physical monitor selection are normalized", () => {
  const settings = normalizeOverlaySettings(
    {
      cursorSize: 999,
      cursorStrokeSize: -10,
      keyDisplayId: 999,
      keyDisplayDuration: 1,
      keyDisplayFontSize: 80,
      annotationPenWidth: 100,
      annotationHighlighterWidth: 1,
      annotationEraserWidth: 500,
    },
    [10, 20],
  );

  assert.equal(settings.cursorSize, 60);
  assert.equal(settings.cursorStrokeSize, 0);
  assert.equal(settings.keyDisplayId, 10);
  assert.equal(settings.keyDisplayDuration, 500);
  assert.equal(settings.keyDisplayFontSize, 60);
  assert.equal(settings.annotationPenWidth, 24);
  assert.equal(settings.annotationHighlighterWidth, 4);
  assert.equal(settings.annotationEraserWidth, 80);
});

test("settings equality rejects incomplete and obsolete runtime data", () => {
  assert.equal(
    overlaySettingsEqual(
      { cursorSize: DEFAULT_OVERLAY_SETTINGS.cursorSize },
      DEFAULT_OVERLAY_SETTINGS,
    ),
    false,
  );
  assert.equal(
    overlaySettingsEqual(
      {
        ...DEFAULT_OVERLAY_SETTINGS,
        keyDisplayMonitor: 0,
        keyDisplayId: undefined,
      },
      DEFAULT_OVERLAY_SETTINGS,
    ),
    false,
  );
});
