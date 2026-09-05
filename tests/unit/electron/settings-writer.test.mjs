import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { DEFAULT_OVERLAY_SETTINGS } from "../../../dist/shared/contract.js";
import { SettingsWriter } from "../../../dist/electron/settings-writer.js";
import { runCleanupSteps } from "../../../dist/electron/shutdown.js";

const settings = (size) => ({ ...DEFAULT_OVERLAY_SETTINGS, cursorSize: size });

test("settings writes coalesce and snapshot the latest values", async () => {
  const writes = [];
  const states = [];
  const writer = new SettingsWriter((value) => writes.push(value), (s) => states.push(s));
  writer.schedule(settings(31));
  const latest = settings(37);
  writer.schedule(latest);
  latest.cursorSize = 59;
  assert.equal(writer.state, "pending");
  await delay(250);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].cursorSize, 37);
  assert.deepEqual(states, ["pending", "saved"]);
});

test("a timer write failure is contained and explicitly retryable", async () => {
  let blocked = true;
  const writes = [];
  const errors = [];
  const writer = new SettingsWriter((value) => {
    if (blocked) throw new Error("EACCES");
    writes.push(value);
  }, () => {}, (error) => errors.push(error));
  writer.schedule(settings(39));
  await delay(250);
  assert.equal(writer.state, "failed");
  assert.equal(errors.length, 1);
  blocked = false;
  assert.equal(writer.flush(), true);
  assert.equal(writer.state, "saved");
  assert.equal(writes[0].cursorSize, 39);
});

test("a new edit supersedes a failed write without losing the latest value", () => {
  let blocked = true;
  const writes = [];
  const writer = new SettingsWriter((value) => {
    if (blocked) throw new Error("ENOSPC");
    writes.push(value);
  }, () => {}, () => {});
  writer.schedule(settings(31));
  assert.equal(writer.flush(), false);
  writer.schedule(settings(41));
  blocked = false;
  assert.equal(writer.flush(), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].cursorSize, 41);
});

test("quit flushes once before debounce and cancels the pending timer", async () => {
  let count = 0;
  const writer = new SettingsWriter(() => { count += 1; }, () => {});
  writer.schedule(settings(37));
  assert.equal(writer.flush(), true);
  assert.equal(writer.flush(), true);
  await delay(250);
  assert.equal(count, 1);
});

test("shutdown continues through every cleanup even when persistence fails", () => {
  const calls = [];
  const errors = [];
  runCleanupSteps([
    () => { calls.push("settings"); throw new Error("write failed"); },
    () => { calls.push("shortcuts"); },
    () => { calls.push("input"); throw new Error("native stop failed"); },
    () => { calls.push("tray"); },
  ], (error) => errors.push(error));
  assert.deepEqual(calls, ["settings", "shortcuts", "input", "tray"]);
  assert.equal(errors.length, 2);
});
