import assert from "node:assert/strict";
import test from "node:test";
import { shortcutVirtualKeys } from "../../../dist/electron/testing/smoke.js";
test("native text-save shortcut injects Control and Enter", () => {
  assert.deepEqual(shortcutVirtualKeys("Ctrl+Enter"), [0x11, 0x0d]);
});
