import assert from "node:assert/strict";
import test from "node:test";

import { readSmokeOptions } from "../dist/electron/smoke.js";

test("smoke tests exercise the default rendering path unless explicitly disabled", () => {
  assert.deepEqual(readSmokeOptions(["MiniCast.exe", "--smoke-test"]), {
    mode: "startup",
    userDataPath: null,
    sentinelPath: null,
    disableHardwareAcceleration: false,
  });
});

test("software-rendering smoke mode is explicit and preserves the sentinel", () => {
  assert.deepEqual(
    readSmokeOptions([
      "MiniCast.exe",
      "--interaction-smoke-test",
      "--disable-hardware-acceleration",
      "--smoke-sentinel=C:\\temp\\result.json",
    ]),
    {
      mode: "interaction",
      userDataPath: null,
      sentinelPath: "C:\\temp\\result.json",
      disableHardwareAcceleration: true,
    },
  );
});
