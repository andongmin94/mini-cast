import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { QuitCoordinator } from "../../../dist/electron/quit-coordinator.js";
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  const calls = { cleanup: 0, blocked: 0, prompts: [], failed: [] };
  const state = { key: "dirty-a", busy: false, publication: null };
  const event = { preventDefault() { calls.blocked++; } };
  const quit = new QuitCoordinator({ publication: () => state.publication, busy: () => state.busy, unsaved: () => state.key,
    confirm: () => { const reply = deferred(); calls.prompts.push(reply); return reply.promise; },
    cleanup: () => calls.cleanup++, resume: () => quit.beforeQuit(event), failed: error => calls.failed.push(error) });
  return { calls, state, event, quit };
}
test("repeated exits coalesce and cancellation keeps cleanup untouched", async () => {
  const { calls, event, quit } = fixture(); quit.beforeQuit(event); quit.beforeQuit(event); await tick();
  assert.equal(calls.prompts.length, 1); assert.equal(quit.waiting, true);
  calls.prompts[0].resolve(false); await tick(); assert.equal(calls.cleanup, 0); assert.equal(quit.waiting, false);
  quit.beforeQuit(event); await tick(); assert.equal(calls.prompts.length, 2);
});
test("explicit discard approves only the reviewed content and cleans up once", async () => {
  const { calls, event, quit } = fixture(); quit.beforeQuit(event); await tick(); calls.prompts[0].resolve(true); await tick();
  quit.beforeQuit(event); assert.equal(calls.cleanup, 1); assert.equal(calls.prompts.length, 1);
});
test("changed documents need a new discard decision, even when the old prompt is accepted", async () => {
  const { calls, state, event, quit } = fixture(); quit.beforeQuit(event); await tick(); state.key = "dirty-b";
  calls.prompts[0].resolve(true); await tick(); assert.equal(calls.cleanup, 0); assert.equal(calls.prompts.length, 2);
  calls.prompts[1].resolve(false); await tick(); assert.equal(calls.cleanup, 0);
});
test("native I/O preparation blocks exit without stacking a second dialog", async () => {
  const { calls, state, event, quit } = fixture(); state.busy = true; quit.beforeQuit(event); await tick();
  assert.equal(calls.cleanup, 0); assert.equal(calls.prompts.length, 0); assert.equal(calls.blocked, 1);
  state.busy = false; quit.beforeQuit(event); await tick(); assert.equal(calls.prompts.length, 1);
});
test("successful pending save is settled before deciding whether a confirmation is needed", async () => {
  const { calls, state, event, quit } = fixture(), write = deferred(); state.publication = write.promise;
  quit.beforeQuit(event); await tick(); assert.equal(calls.prompts.length, 0);
  state.publication = null; state.key = null; write.resolve(); await tick();
  assert.equal(calls.cleanup, 1); assert.equal(calls.prompts.length, 0);
});
test("saving an old snapshot still prompts for edits not covered by that save", async () => {
  const { calls, state, event, quit } = fixture(), write = deferred(); state.publication = write.promise;
  quit.beforeQuit(event); state.publication = null; write.resolve(); await tick();
  assert.equal(calls.cleanup, 0); assert.equal(calls.prompts.length, 1);
});
test("a failed write never consumes unsaved contents or resumes quit", async () => {
  const { calls, state, event, quit } = fixture(), write = deferred(); state.publication = write.promise;
  quit.beforeQuit(event); state.publication = null; write.reject(new Error("disk full")); await tick();
  assert.equal(calls.cleanup, 0); assert.equal(calls.prompts.length, 0); assert.equal(calls.failed.length, 1);
  quit.beforeQuit(event); await tick(); assert.equal(calls.prompts.length, 1);
});
test("a rejected confirmation fails closed and permits a fresh attempt", async () => {
  const { calls, event, quit } = fixture(); quit.beforeQuit(event); await tick(); calls.prompts[0].reject(new Error("dialog gone")); await tick();
  assert.equal(calls.cleanup, 0); assert.equal(quit.waiting, false); assert.equal(calls.failed.length, 1);
  quit.beforeQuit(event); await tick(); assert.equal(calls.prompts.length, 2);
});
test("permission is not reused across newly started publication or I/O preparation", async () => {
  const { calls, state, event, quit } = fixture(); quit.beforeQuit(event); await tick(); state.busy = true;
  calls.prompts[0].resolve(true); await tick(); assert.equal(calls.cleanup, 0);
  state.busy = false; quit.beforeQuit(event); await tick(); assert.equal(calls.prompts.length, 2);
});
