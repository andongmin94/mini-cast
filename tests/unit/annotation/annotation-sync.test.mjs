import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationHistory } from "../../../dist/annotation/history.js";
import {
  AnnotationReplica,
  createAnnotationUpdate,
  reduceAnnotationUpdate,
} from "../../../dist/annotation/document-sync.js";

const stroke = (id, x = 4) => ({
  id,
  tool: "pen",
  color: "#123456",
  width: 4,
  opacity: 1,
  points: [
    { x, y: 6 },
    { x: x + 12, y: 22 },
  ],
});
function history() {
  const h = new AnnotationHistory();
  h.setDisplayViewport(1, 100, 100);
  return h;
}
function apply(current, update) {
  const result = reduceAnnotationUpdate(current, 1, structuredClone(update));
  assert.notEqual(result.kind, "resync");
  return result.kind === "adopt" ? result.document : current;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("initial and viewport-reset updates contain explicit snapshots", () => {
  const h = history();
  const initial = h.getSnapshot(1);
  assert.equal(createAnnotationUpdate(undefined, initial).kind, "snapshot");
  h.setDisplayViewport(1, 200, 100);
  assert.equal(
    createAnnotationUpdate(initial, h.getSnapshot(1)).kind,
    "snapshot",
  );
});

test("append sends only the new geometry and deletion sends only IDs", () => {
  const h = history();
  h.addStroke(1, stroke("a"));
  const a = h.getSnapshot(1);
  h.addStroke(1, stroke("b"));
  const b = h.getSnapshot(1);
  const added = createAnnotationUpdate(a, b);
  assert.equal(added.kind, "delta");
  assert.deepEqual(
    added.inserted.map((x) => x.stroke.id),
    ["b"],
  );
  assert.deepEqual(added.removedIds, []);
  const replica = apply(structuredClone(a), added);
  assert.deepEqual(replica, b);
  h.removeStrokes(1, ["a"]);
  const next = h.getSnapshot(1);
  const removed = createAnnotationUpdate(b, next);
  assert.equal(removed.kind, "delta");
  assert.deepEqual(removed.removedIds, ["a"]);
  assert.deepEqual(removed.inserted, []);
  assert.deepEqual(apply(replica, removed), next);
});

test("multi-stroke Undo inserts into final positions while sharing surviving geometry", () => {
  const h = history();
  for (let i = 0; i < 6; i++) h.addStroke(1, stroke(String(i)));
  h.removeStrokes(1, ["0", "2", "3", "5"]);
  const before = h.getSnapshot(1);
  const local = structuredClone(before);
  h.undo();
  const next = h.getSnapshot(1);
  const update = createAnnotationUpdate(before, next);
  assert.equal(update.kind, "delta");
  assert.deepEqual(
    update.inserted.map((x) => x.index),
    [0, 2, 3, 5],
  );
  const restored = apply(local, update);
  assert.deepEqual(restored, next);
  assert.equal(restored.strokes[1], local.strokes[0]);
  assert.equal(restored.strokes[4], local.strokes[1]);
});

test("duplicate and stale updates cannot resurrect an undone stroke", () => {
  const h = history();
  const a = h.getSnapshot(1);
  h.addStroke(1, stroke("b"));
  const b = h.getSnapshot(1);
  const add = createAnnotationUpdate(a, b);
  h.undo();
  const c = h.getSnapshot(1);
  const undo = createAnnotationUpdate(b, c);
  let local = apply(structuredClone(a), add);
  local = apply(local, undo);
  assert.equal(apply(local, add), local);
  assert.equal(apply(local, undo), local);
  assert.deepEqual(local, c);
});

test("gaps, malformed indices, unknown removals and duplicate IDs reject atomically", () => {
  const h = history();
  h.addStroke(1, stroke("a"));
  const current = h.getSnapshot(1);
  const delta = {
    kind: "delta",
    displayId: 1,
    baseRevision: current.revision,
    revision: current.revision + 1,
    removedIds: [],
    inserted: [],
  };
  const broken = [
    { ...delta, baseRevision: delta.baseRevision - 1 },
    { ...delta, removedIds: ["missing"] },
    { ...delta, removedIds: ["a", "a"] },
    { ...delta, inserted: [{ index: -1, stroke: stroke("b") }] },
    { ...delta, inserted: [{ index: 3, stroke: stroke("b") }] },
    { ...delta, inserted: [{ index: 1, stroke: stroke("a") }] },
    {
      ...delta,
      inserted: [
        { index: 1, stroke: stroke("b") },
        { index: 1, stroke: stroke("c") },
      ],
    },
    {
      ...delta,
      inserted: [{ index: 1, stroke: { ...stroke("b"), width: Infinity } }],
    },
  ];
  for (const update of broken)
    assert.equal(reduceAnnotationUpdate(current, 1, update).kind, "resync");
  assert.equal(current.strokes.length, 1);
});

test("a revision-only rejection does not transfer existing geometry", () => {
  const h = history();
  const doc = h.getSnapshot(1);
  assert.equal(
    reduceAnnotationUpdate(doc, 1, {
      kind: "revision",
      displayId: 1,
      revision: doc.revision,
    }).kind,
    "ignore",
  );
  assert.equal(
    reduceAnnotationUpdate(doc, 1, {
      kind: "revision",
      displayId: 1,
      revision: doc.revision + 1,
    }).kind,
    "resync",
  );
  assert.equal(
    reduceAnnotationUpdate(doc, 2, { kind: "snapshot", document: doc }).kind,
    "ignore",
  );
});

test("reordered retained objects require an explicit document reset", () => {
  const h = history();
  h.addStroke(1, stroke("a"));
  h.addStroke(1, stroke("b"));
  const before = h.getSnapshot(1);
  const next = {
    ...before,
    revision: before.revision + 1,
    strokes: [...before.strokes].reverse(),
  };
  assert.equal(createAnnotationUpdate(before, next).kind, "snapshot");
});

test("seeded add/remove/Undo/Redo/Clear updates match authoritative history for 2000 edits", () => {
  const h = history();
  let published = h.getSnapshot(1);
  let local = structuredClone(published);
  let seed = 8291;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 2000; i++) {
    const op = next() % 8;
    if (op < 3) h.addStroke(1, stroke(`s-${i}`, next() % 90));
    else if (op === 3) h.undo();
    else if (op === 4) h.redo();
    else if (op === 5)
      h.removeStrokes(
        1,
        published.strokes.filter((_, j) => j % 3 === 0).map((s) => s.id),
      );
    else if (op === 6) h.clearDisplay(1);
    else h.setDisplayViewport(1, 100 + (next() % 3) * 25, 100);
    const current = h.getSnapshot(1);
    local = apply(local, createAnnotationUpdate(published, current));
    assert.deepEqual(local, current);
    published = current;
  }
});

test("small edit payload does not scale with unrelated 128k-point geometry", () => {
  const h = history();
  for (let i = 0; i < 1000; i++)
    h.addStroke(1, {
      ...stroke(`s-${i}`),
      points: Array.from({ length: 128 }, (_, j) => ({ x: j, y: i })),
    });
  const before = h.getSnapshot(1);
  h.addStroke(1, stroke("new"));
  const after = h.getSnapshot(1);
  const delta = createAnnotationUpdate(before, after);
  assert.equal(delta.kind, "delta");
  const bytes = Buffer.byteLength(JSON.stringify(delta));
  assert.ok(bytes < 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(after)) > 1_000_000);
  console.log(
    "DELTA_PAYLOAD_WORK",
    JSON.stringify({
      snapshotBytes: Buffer.byteLength(JSON.stringify(after)),
      editBytes: bytes,
    }),
  );
});

test("invoke response and pushed Undo arriving in reverse order converge without stale resurrection", async () => {
  const h = history();
  const a = h.getSnapshot(1);
  h.addStroke(1, stroke("b"));
  const b = h.getSnapshot(1);
  h.undo();
  const c = h.getSnapshot(1);
  const pending = deferred();
  let calls = 0;
  const seen = [];
  const replica = new AnnotationReplica(
    () => {
      calls++;
      return pending.promise;
    },
    (doc) => seen.push(doc),
  );
  replica.reset(1);
  await replica.receive({ kind: "snapshot", document: a });
  const undo = replica.receive(createAnnotationUpdate(b, c));
  await replica.receive(createAnnotationUpdate(a, b));
  pending.resolve(c);
  await undo;
  await replica.receive(createAnnotationUpdate(a, b));
  assert.equal(calls, 1);
  assert.deepEqual(replica.document, c);
  assert.equal(seen.at(-1).strokes.length, 0);
});

test("concurrent gaps share recovery and refetch when the first snapshot predates a newer edit", async () => {
  const h = history();
  const a = h.getSnapshot(1);
  h.addStroke(1, stroke("b"));
  const b = h.getSnapshot(1);
  h.addStroke(1, stroke("c"));
  const c = h.getSnapshot(1);
  const first = deferred();
  let calls = 0;
  const replica = new AnnotationReplica(
    () => (++calls === 1 ? first.promise : Promise.resolve(c)),
    () => {},
  );
  replica.reset(1);
  const one = replica.receive({
    kind: "revision",
    displayId: 1,
    revision: b.revision,
  });
  await tick();
  const two = replica.receive({
    kind: "revision",
    displayId: 1,
    revision: c.revision,
  });
  first.resolve(b);
  await Promise.all([one, two]);
  assert.equal(calls, 2);
  assert.deepEqual(replica.document, c);
  assert.ok(a.revision < b.revision);
});

test("recovery never replaces a newer pushed snapshot with an older reply", async () => {
  const h = history();
  const a = h.getSnapshot(1);
  h.addStroke(1, stroke("b"));
  const b = h.getSnapshot(1);
  const pending = deferred();
  const replica = new AnnotationReplica(
    () => pending.promise,
    () => {},
  );
  replica.reset(1);
  const recovery = replica.receive({
    kind: "revision",
    displayId: 1,
    revision: a.revision,
  });
  await replica.receive({ kind: "snapshot", document: b });
  pending.resolve(a);
  await recovery;
  assert.equal(replica.document, b);
});

test("display reset discards an old in-flight recovery, even when display ID is reused", async () => {
  const h = history();
  const pending = deferred();
  let notifications = 0;
  const replica = new AnnotationReplica(
    () => pending.promise,
    () => {
      notifications++;
    },
  );
  replica.reset(1);
  const old = replica.receive({ kind: "revision", displayId: 1, revision: 1 });
  await tick();
  replica.reset(1);
  pending.resolve(h.getSnapshot(1));
  assert.equal(await old, null);
  assert.equal(replica.document, null);
  assert.equal(notifications, 0);
});

test("failed recovery is surfaced and the next update can retry", async () => {
  const h = history();
  const doc = h.getSnapshot(1);
  let calls = 0;
  const replica = new AnnotationReplica(
    () =>
      ++calls === 1
        ? Promise.reject(new Error("transport"))
        : Promise.resolve(doc),
    () => {},
  );
  replica.reset(1);
  await assert.rejects(
    replica.receive({ kind: "revision", displayId: 1, revision: doc.revision }),
    /transport/,
  );
  await replica.receive({
    kind: "revision",
    displayId: 1,
    revision: doc.revision,
  });
  assert.equal(replica.document, doc);
});
