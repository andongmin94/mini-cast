import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate as tick } from "node:timers/promises";
import test from "node:test";
import { AnnotationIoGate } from "../../../dist/electron/annotation-io-gate.js";
import { AnnotationIoLifetime } from "../../../dist/electron/annotation-io-lifetime.js";
import { QuitCoordinator } from "../../../dist/electron/quit-coordinator.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const gate = new AnnotationIoGate();
  const calls = { blocked: 0, cleanup: 0, resumed: 0, failed: [] };
  const event = { preventDefault() { calls.blocked++; } };
  const quit = new QuitCoordinator({ busy: () => false, unsaved: () => null, confirm: async () => true, publication: () => gate.publication,
    cleanup: () => calls.cleanup++, resume: () => { calls.resumed++; quit.beforeQuit(event); },
    failed: error => calls.failed.push(error) });
  return { gate, quit, event, calls };
}

test("normal quit without an authorized write cleans up exactly once", () => {
  const { quit, event, calls } = fixture(); quit.beforeQuit(event); quit.beforeQuit(event);
  assert.equal(calls.cleanup, 1); assert.equal(calls.blocked, 0);
});
test("repeated quits wait for a write and keep all resources intact until success", async () => {
  const { gate, quit, event, calls } = fixture(); const release = gate.acquire(); const write = deferred();
  const publication = gate.publish(() => write.promise);
  const handled = publication.finally(release);
  quit.beforeQuit(event); quit.beforeQuit(event); quit.beforeQuit(event);
  assert.equal(quit.waiting, true); assert.equal(calls.cleanup, 0); assert.equal(calls.blocked, 3);
  write.resolve(); await handled; await tick();
  assert.equal(calls.cleanup, 1); assert.equal(calls.resumed, 1); assert.equal(quit.waiting, false);
});
test("failed publication cancels quit without cleanup and permits a fresh save/retry", async () => {
  const { gate, quit, event, calls } = fixture(); const release = gate.acquire(); const write = deferred();
  const publication = gate.publish(() => write.promise); const handled = publication.catch(() => undefined).finally(release);
  quit.beforeQuit(event); const error = new Error("disk full"); write.reject(error); await handled; await tick();
  assert.equal(calls.cleanup, 0); assert.equal(calls.resumed, 0); assert.deepEqual(calls.failed, [error]);
  assert.equal(quit.waiting, false); assert.equal(gate.busy, false);
  const releaseRetry = gate.acquire(); await gate.publish(async () => {}); releaseRetry();
  quit.beforeQuit(event); assert.equal(calls.cleanup, 1);
});
test("synchronous write exceptions enter the same failed-publication path", async () => {
  const { gate, quit, event, calls } = fixture(); const release = gate.acquire();
  const publication = gate.publish(() => { throw new Error("sync failure"); });
  const handled = publication.catch(() => undefined).finally(release); quit.beforeQuit(event);
  await handled; await tick(); assert.equal(calls.cleanup, 0); assert.equal(calls.failed[0].message, "sync failure");
});
test("premature lease release cannot unlock an in-flight write", async () => {
  const gate = new AnnotationIoGate(); const release = gate.acquire(); const write = deferred();
  const publication = gate.publish(() => write.promise); release();
  assert.equal(gate.busy, true); assert.equal(gate.acquire(), null); assert.equal(gate.publication, publication);
  write.resolve(); await publication; await tick(); assert.equal(gate.busy, false);
  const next = gate.acquire(); release(); assert.equal(gate.busy, true); next();
});
test("publication requires a live lease and rejects duplicate publication", async () => {
  const gate = new AnnotationIoGate(); assert.throws(() => gate.publish(async () => {}));
  const release = gate.acquire(); await gate.publish(async () => {});
  assert.throws(() => gate.publish(async () => {})); release();
});
for (const event of ["hide", "minimize", "did-start-loading", "destroyed"]) {
  test(`preparation stays invalid after ${event}, including hide/show cycles`, () => {
    const owner = new EventEmitter(); let cancellations = 0;
    const lifetime = new AnnotationIoLifetime(() => cancellations++); lifetime.watch(owner, [event]);
    owner.emit(event); owner.emit("show"); owner.emit(event);
    assert.equal(lifetime.invalidated, true); assert.equal(cancellations, 1);
    const gate = new AnnotationIoGate(); const release = gate.acquire();
    assert.throws(() => lifetime.publish(gate, async () => {})); release();
    lifetime.dispose(); lifetime.dispose(); assert.equal(owner.listenerCount(event), 0);
  });
}
test("approved writes survive owner invalidation but do not leak subscriptions", async () => {
  const owner = new EventEmitter(), gate = new AnnotationIoGate(), write = deferred();
  const release = gate.acquire(); const lifetime = new AnnotationIoLifetime();
  lifetime.watch(owner, ["hide", "did-start-loading", "destroyed"]);
  const publication = lifetime.publish(gate, () => write.promise);
  owner.emit("hide"); owner.emit("did-start-loading"); owner.emit("destroyed");
  assert.equal(lifetime.invalidated, false); assert.equal(gate.publication, publication);
  write.resolve(); await publication; lifetime.dispose(); release(); assert.deepEqual(owner.eventNames(), []);
});
test("a second publication appearing during quit resumption must also settle", async () => {
  const gate = new AnnotationIoGate(); const first = deferred(), second = deferred();
  let cleanup = 0, resumes = 0; const event = { preventDefault() {} };
  const release = gate.acquire(); const publication = gate.publish(() => first.promise);
  const handled = publication.finally(release); let handledSecond;
  const quit = new QuitCoordinator({ busy: () => false, unsaved: () => null, confirm: async () => true, publication: () => gate.publication, cleanup: () => cleanup++,
    resume() {
      resumes++;
      if (resumes === 1) { const finish = gate.acquire(); handledSecond = gate.publish(() => second.promise).finally(finish); }
      quit.beforeQuit(event);
    }, failed(error) { throw error; } });
  quit.beforeQuit(event); first.resolve(); await handled; await tick(); assert.equal(cleanup, 0);
  second.resolve(); await handledSecond; await tick(); assert.equal(cleanup, 1); assert.equal(resumes, 2);
});
