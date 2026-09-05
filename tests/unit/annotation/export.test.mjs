import assert from "node:assert/strict";
import test from "node:test";
import { AnnotationHistory } from "../../../dist/annotation/history.js";
import { MAX_EXPORT_PIXELS, MAX_EXPORT_SIDE, MAX_EXPORT_PNG_BYTES, AnnotationExportError,
  readAnnotationExportRequest, planAnnotationExport, hasExpectedPngHeader, annotationExportMessage } from "../../../dist/annotation/export.js";

function fixture(width = 100, height = 80) {
  const history = new AnnotationHistory();
  history.setDisplayViewport(1, width, height);
  history.addElement(1, { id: "ink", tool: "pen", color: "#FF0000", opacity: 1, width: 3,
    points: [{ x: 3, y: 4 }, { x: 70, y: 60 }] });
  return history;
}
function header(width = 100, height = 80) {
  const bytes = new Uint8Array(33);
  bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

test("export accepts only explicit display/destination requests, never renderer paths or sizes", () => {
  for (const destination of ["file", "clipboard"])
    assert.deepEqual(readAnnotationExportRequest({ displayId: -4, destination }), { displayId: -4, destination });
  for (const value of [null, [], {}, "clipboard", { displayId: 1, destination: "desktop" },
    { displayId: NaN, destination: "file" }, { displayId: "1", destination: "file" },
    { displayId: 1.5, destination: "file" }, { displayId: 1, destination: "file", path: "/tmp/file.png" },
    { displayId: 1, destination: "file", width: 300 }]) assert.equal(readAnnotationExportRequest(value), null);
});
for (const ratio of [1, 1.25, 1.5, 2, 2.5]) test(`export dimensions use the physical scale ${ratio}`, () => {
  assert.deepEqual(planAnnotationExport(fixture().getSnapshot(1), ratio), { width: Math.round(100 * ratio), height: Math.round(80 * ratio) });
});
test("export limits reject huge or invalid output rather than silently downscaling", () => {
  const snapshot = fixture().getSnapshot(1);
  for (const [width,height,scale] of [[8193,1,1],[4097,4097,1],[100,80,0],[100,80,NaN],[100,80,Infinity],[1,1,0.01]])
    assert.throws(() => planAnnotationExport({ ...snapshot, viewport: {width,height} }, scale), AnnotationExportError);
  assert.deepEqual(planAnnotationExport({ ...snapshot, viewport: {width:4096,height:4096} }, 1), {width:4096,height:4096});
  assert.equal(MAX_EXPORT_PIXELS, 4096*4096); assert.equal(MAX_EXPORT_SIDE, 8192);
});
test("empty documents and disconnected viewports do not produce empty user output", () => {
  const h=fixture(); h.clearDisplay(1);
  assert.throws(() => planAnnotationExport(h.getSnapshot(1),1), error => error.reason === "empty");
  assert.throws(() => planAnnotationExport({...h.getSnapshot(1),viewport:null},1), error => error.reason === "unavailable");
});
test("pinning an export does not change history, and later edits cannot change its content", () => {
  const h=fixture(); h.addElement(1,{...h.getSnapshot(1).elements[0],id:"second"}); h.undo();
  const snapshot=h.getSnapshot(1), original=JSON.stringify(snapshot);
  planAnnotationExport(snapshot,2);
  assert.strictEqual(h.getSnapshot(1), snapshot); assert.equal(h.canRedo,true);
  h.redo(); h.clearDisplay(1);
  assert.equal(JSON.stringify(snapshot),original);
});
test("PNG preflight validates signature, IHDR, dimensions, offsets and byte budget", () => {
  assert.ok(hasExpectedPngHeader(header(),{width:100,height:80}));
  const storage=new Uint8Array(100); storage.set(header(),7);
  assert.ok(hasExpectedPngHeader(storage.subarray(7,40),{width:100,height:80}));
  for(const bad of [null, [], Array.from(header()),new Uint8Array(10), header(200,80), header(100,800), new Uint8Array(MAX_EXPORT_PNG_BYTES+1)])
    assert.equal(hasExpectedPngHeader(bad,{width:100,height:80}),false);
  for(const index of [0,1,2,3,4,5,6,7,11,12]) {
    const bytes=header(); bytes[index]^=1; assert.equal(hasExpectedPngHeader(bytes,{width:100,height:80}),false);
  }
});
test("each export failure has an actionable user-facing message", () => {
  for(const reason of ["invalid-request","empty","too-large","unavailable","busy","timeout","render-failed","write-failed","cancelled"])
    assert.ok(annotationExportMessage(reason).length>10);
});
