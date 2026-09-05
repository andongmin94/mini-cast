import assert from "node:assert/strict";
import test from "node:test";

import {
  colorForEditor,
  normalizeHexColor,
  normalizeRgbaColor,
  parseCssColor,
  rgbaFromEditor,
} from "../../../dist/shared/color.js";

test("legacy hex and rgb colors normalize to canonical persisted forms", () => {
  assert.equal(normalizeRgbaColor("#06f", "#000000"), "rgba(0, 102, 255, 1)");
  assert.equal(
    normalizeRgbaColor("rgb(1, 2, 3)", "#000000"),
    "rgba(1, 2, 3, 1)",
  );
  assert.equal(normalizeHexColor("rgba(255, 0, 16, 0.4)", "#000000"), "#FF0010");
});

test("editor conversion preserves RGB and transparency", () => {
  assert.deepEqual(colorForEditor("rgba(10, 20, 30, 0.25)", "#000000"), {
    color: "#0A141E",
    opacity: 0.75,
  });
  assert.equal(rgbaFromEditor("#0A141E", 0.75), "rgba(10, 20, 30, 0.25)");
});

test("invalid and out-of-range colors use explicit fallbacks", () => {
  assert.equal(parseCssColor("rgb(999, 0, 0)"), null);
  assert.equal(
    normalizeRgbaColor("not-a-color", "rgba(4, 5, 6, 0.5)"),
    "rgba(4, 5, 6, 0.5)",
  );
  assert.equal(normalizeHexColor("#12345678", "#000000"), "#123456");
});
