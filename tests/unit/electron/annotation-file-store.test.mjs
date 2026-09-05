import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAnnotationFile, saveAnnotationFile } from "../../../dist/electron/annotation-file-store.js";
import { AnnotationIoGate } from "../../../dist/electron/annotation-io-gate.js";
import { MAX_ANNOTATION_FILE_BYTES } from "../../../dist/annotation/document-file.js";
const encoded = JSON.stringify({ format: "MiniCast", version: 1, viewport: { width: 100, height: 80 }, elements: [] }) + "\n";
async function directory(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "mini-cast-file-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
test("editable file writes round-trip Unicode paths, replace atomically and leave no temp files", async () => directory(async dir => {
  const file = path.join(dir, "한글 판서.MINICAST"); await writeFile(file, "old");
  await saveAnnotationFile(file, encoded);
  assert.equal(await readFile(file, "utf8"), encoded); assert.equal((await loadAnnotationFile(file)).version, 1);
  assert.deepEqual(await readdir(dir), ["한글 판서.MINICAST"]);
}));
test("invalid writes preserve an existing file and a failed atomic replacement preserves a directory", async () => directory(async dir => {
  const file = path.join(dir, "saved.minicast"); await saveAnnotationFile(file, encoded);
  await assert.rejects(saveAnnotationFile(file, "{bad")); assert.equal(await readFile(file, "utf8"), encoded);
  const blocked = path.join(dir, "blocked.minicast"); await mkdir(blocked); await writeFile(path.join(blocked, "keep"), "preserved");
  await assert.rejects(saveAnnotationFile(blocked, encoded));
  assert.equal(await readFile(path.join(blocked, "keep"), "utf8"), "preserved");
  assert.deepEqual((await readdir(dir)).sort(), ["blocked.minicast", "saved.minicast"]);
}));
test("reads reject directories, invalid UTF-8, malformed JSON and truncated files", async () => directory(async dir => {
  const folder = path.join(dir, "folder.minicast"); await mkdir(folder); await assert.rejects(loadAnnotationFile(folder));
  const file = path.join(dir, "bad.minicast");
  for (const bytes of [Buffer.from([0xff, 0xfe, 0x00]), Buffer.from(""), Buffer.from("{\"format\":")]) {
    await writeFile(file, bytes); await assert.rejects(loadAnnotationFile(file));
  }
}));
test("oversized sparse files are refused before allocating their content", async () => directory(async dir => {
  const file = path.join(dir, "huge.minicast"); const h = await open(file, "w");
  try { await h.truncate(MAX_ANNOTATION_FILE_BYTES + 1); } finally { await h.close(); }
  await assert.rejects(loadAnnotationFile(file), e => e.reason === "too-large");
}));
test("cancellation closes the read handle without publishing a partial document", async () => directory(async dir => {
  const file = path.join(dir, "cancel.minicast"); await saveAnnotationFile(file, encoded);
  await assert.rejects(loadAnnotationFile(file, () => true), e => e.reason === "unavailable");
  await rm(file); assert.deepEqual(await readdir(dir), []);
}));
test("file operations require an absolute .minicast path", async () => {
  for (const file of ["relative.minicast", path.join(tmpdir(), "data.exe"), path.join(tmpdir(), "data.minicast.txt")]) {
    await assert.rejects(loadAnnotationFile(file)); await assert.rejects(saveAnnotationFile(file, encoded));
  }
});
test("file/PNG operation gates reject overlaps and old releases cannot unlock new operations", () => {
  const gate = new AnnotationIoGate(); const first = gate.acquire(); assert.equal(typeof first, "function");
  assert.equal(gate.acquire(), null); first(); assert.equal(gate.busy, false);
  const second = gate.acquire(); first(); assert.equal(gate.busy, true); assert.equal(gate.acquire(), null);
  second(); assert.equal(gate.busy, false);
});
