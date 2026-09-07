import assert from "node:assert/strict";
import test from "node:test";

import { withDefaultExtension } from "../../../dist/electron/native-save-path.js";

test("native save paths append the selected format only when no extension was typed", () => {
  assert.equal(withDefaultExtension("C:\\work\\lecture", "minicast"), "C:\\work\\lecture.minicast");
  assert.equal(withDefaultExtension("C:\\work\\lecture.minicast", "minicast"), "C:\\work\\lecture.minicast");
  assert.equal(withDefaultExtension("C:\\work\\lecture.MINICAST", "minicast"), "C:\\work\\lecture.MINICAST");
  assert.equal(withDefaultExtension("C:\\work\\lecture.txt", "minicast"), "C:\\work\\lecture.txt");
  assert.equal(withDefaultExtension("C:\\work\\capture", "png"), "C:\\work\\capture.png");
  assert.equal(withDefaultExtension("C:\\work\\capture.jpg", "png"), "C:\\work\\capture.jpg");
});
