import assert from "node:assert/strict";
import test from "node:test";
import {
  AnnotationBoards, ANNOTATION_BOARD_MODES, annotationBoardBackground,
  isAnnotationBoardMode, newerAnnotationBoards, readAnnotationBoardRequest,
} from "../../../dist/annotation/board.js";

test("boards accept only explicit target displays and three presentation modes", () => {
  for (const mode of ANNOTATION_BOARD_MODES) {
    assert.equal(isAnnotationBoardMode(mode), true);
    assert.deepEqual(readAnnotationBoardRequest({ displayId: -1, mode }), { displayId: -1, mode });
  }
  for (const value of [null, [], {}, { displayId: 1 }, { displayId: 1, mode: "red" },
    { displayId: 1.2, mode: "white" }, { displayId: Infinity, mode: "black" },
    { displayId: 1, mode: "white", color: "url(x)" }, { displayId: "1", mode: "white" }])
    assert.equal(readAnnotationBoardRequest(value), null);
  assert.equal(readAnnotationBoardRequest(Object.create({ displayId: 1, mode: "white" })), null);
});

test("all backgrounds are invisible in pass-through, including an enabled blackboard", () => {
  for (const mode of ANNOTATION_BOARD_MODES) assert.equal(annotationBoardBackground(mode, false), "transparent");
  assert.equal(annotationBoardBackground("white", true), "#FFFFFF");
  assert.equal(annotationBoardBackground("black", true), "#000000");
  assert.equal(annotationBoardBackground("transparent", true), "rgba(0, 0, 0, 0.004)");
});

test("board selection is scoped to a connected monitor and starts transparent", () => {
  const boards = new AnnotationBoards();
  boards.retainDisplays([2, 1]);
  assert.deepEqual(boards.snapshot.displays, [{ displayId: 1, mode: "transparent" }, { displayId: 2, mode: "transparent" }]);
  boards.set(1, "white");
  assert.deepEqual(boards.snapshot.displays, [{ displayId: 1, mode: "white" }, { displayId: 2, mode: "transparent" }]);
  assert.throws(() => boards.set(3, "black"));
  assert.throws(() => boards.set(1, "url(x)"));
});

test("no-op commands and reordered monitor notifications preserve the cached revision", () => {
  const boards = new AnnotationBoards(); boards.retainDisplays([1, 2]);
  const before = boards.snapshot;
  assert.equal(boards.retainDisplays([2, 1]), false);
  assert.equal(boards.set(1, "transparent"), false);
  assert.equal(boards.snapshot, before);
});

test("snapshots are immutable, independently cloneable and cannot rewrite previous mode choices", () => {
  const boards = new AnnotationBoards(); boards.retainDisplays([1]);
  const before = boards.snapshot;
  assert.throws(() => { before.displays[0].mode = "black"; }, TypeError);
  assert.throws(() => before.displays.push({ displayId: 2, mode: "white" }), TypeError);
  boards.set(1, "white");
  assert.equal(before.displays[0].mode, "transparent");
  const clone = structuredClone(boards.snapshot); clone.displays[0].mode = "black";
  assert.equal(boards.snapshot.displays[0].mode, "white");
});

test("display rebuild retains backgrounds; disconnection releases them rather than resurrecting old state", () => {
  const boards = new AnnotationBoards(); boards.retainDisplays([1, 2]); boards.set(2, "black");
  boards.retainDisplays([2, 3]);
  assert.equal(boards.has(1), false);
  assert.equal(boards.snapshot.displays[0].mode, "black");
  boards.retainDisplays([1, 3]); boards.retainDisplays([1, 2, 3]);
  assert.equal(boards.snapshot.displays.find(item => item.displayId === 2).mode, "transparent");
});

test("invalid display updates reject atomically without changing the previous snapshot", () => {
  const boards = new AnnotationBoards(); boards.retainDisplays([1]); boards.set(1, "black");
  const before = boards.snapshot;
  for (const ids of [[1, 1], [NaN], [1, 2.3], ["1"], [Infinity]]) assert.throws(() => boards.retainDisplays(ids));
  assert.equal(boards.snapshot, before);
});

test("delayed get-state responses cannot replace more recent background commands", () => {
  const boards = new AnnotationBoards(); boards.retainDisplays([1]); const old = boards.snapshot;
  boards.set(1, "white"); const current = boards.snapshot;
  assert.equal(newerAnnotationBoards(null, old), old);
  assert.equal(newerAnnotationBoards(old, current), current);
  assert.equal(newerAnnotationBoards(current, old), current);
  assert.equal(newerAnnotationBoards(current, structuredClone(current)), current);
});

test("many background switches remain bounded to connected displays and never alter retained snapshots", () => {
  const boards = new AnnotationBoards(); boards.retainDisplays([1, 2]);
  const original = boards.snapshot;
  for (let index = 0; index < 5000; index += 1) boards.set(index % 2 + 1, ANNOTATION_BOARD_MODES[index % 3]);
  assert.equal(boards.snapshot.displays.length, 2);
  assert.deepEqual(original.displays, [{ displayId: 1, mode: "transparent" }, { displayId: 2, mode: "transparent" }]);
  boards.retainDisplays([]); assert.deepEqual(boards.snapshot.displays, []);
});
