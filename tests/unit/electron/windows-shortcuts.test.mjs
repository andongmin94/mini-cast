import assert from "node:assert/strict";
import test from "node:test";
import { shortcutVirtualKeys } from "../../../dist/electron/testing/smoke.js";

test("Windows shortcut injection maps the actual production accelerators", () => {
  assert.deepEqual(shortcutVirtualKeys("Alt+Shift+3"), [0x12, 0x10, 0x33]);
  assert.deepEqual(
    shortcutVirtualKeys("CommandOrControl+Shift+Z"),
    [0x11, 0x10, 0x5a],
  );
  assert.deepEqual(shortcutVirtualKeys("Escape"), [0x1b]);
  assert.throws(() => shortcutVirtualKeys("Alt+not-a-key"), /Unsupported/);
});
