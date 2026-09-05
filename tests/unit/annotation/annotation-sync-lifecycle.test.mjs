import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationReplica } from "../../../dist/annotation/document-sync.js";

function delayedFailure() {
  let reject;
  const promise = new Promise((_resolve, fail) => { reject = fail; });
  return { promise, fail: () => reject(new Error("late transport failure")) };
}
const nextTask = () => new Promise(resolve => setImmediate(resolve));
const snapshot = revision => ({ displayId: 1, revision, viewport: { width: 100, height: 100 }, strokes: [] });

test("a rejected recovery from a previous renderer generation is discarded", async () => {
  const pending = delayedFailure();
  const replica = new AnnotationReplica(() => pending.promise, () => {});
  replica.reset(1);
  const old = replica.receive({ kind: "revision", displayId: 1, revision: 4 });
  await nextTask();
  replica.reset(1);
  const current = snapshot(1);
  await replica.receive({ kind: "snapshot", document: current });
  pending.fail();
  assert.equal(await old, null);
  assert.equal(replica.document, current);
});

test("a pushed current document supersedes an in-flight recovery failure", async () => {
  const pending = delayedFailure();
  const replica = new AnnotationReplica(() => pending.promise, () => {});
  replica.reset(1);
  const recovery = replica.receive({ kind: "revision", displayId: 1, revision: 4 });
  await nextTask();
  const current = snapshot(5);
  await replica.receive({ kind: "snapshot", document: current });
  pending.fail();
  assert.equal(await recovery, current);
  assert.equal(replica.document, current);
});
