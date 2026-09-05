import assert from "node:assert/strict";
import test from "node:test";
import { ExportRenderSession } from "../../../dist/electron/export-render-session.js";

const size={width:100,height:80};
function header() {
  const bytes=Buffer.alloc(33);
  bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  bytes.writeUInt32BE(100,16); bytes.writeUInt32BE(80,20); return bytes;
}
test("render replies require both the requested window and the random job token",async()=>{
  const s=new ExportRenderSession(), promise=s.begin(11,"request-a",size);
  assert.equal(s.reply(12,"request-a",header()),false);
  assert.equal(s.reply(11,"request-b",header()),false);
  assert.equal(s.reply(11,"request-a",header()),true);
  assert.deepEqual(await promise,new Uint8Array(header()));
  assert.equal(s.reply(11,"request-a",header()),false);
});
test("a received PNG is copied even when the sender supplied a Node Buffer",async()=>{
  const s=new ExportRenderSession(), promise=s.begin(11,"request",size);
  const bytes=header(); s.reply(11,"request",bytes); bytes.fill(0);
  assert.deepEqual(await promise,new Uint8Array(header()));
});
test("matching malformed images reject the job and leave it retryable",async()=>{
  const s=new ExportRenderSession();
  for(const bytes of [null,[],new Uint8Array(2)]) {
    const promise=s.begin(11,"request",size);
    s.reply(11,"request",bytes);
    await assert.rejects(promise,error=>error.reason==="render-failed");
  }
});
test("overlapping renders reject instead of replacing the first operation",async()=>{
  const s=new ExportRenderSession(), promise=s.begin(11,"a",size);
  assert.throws(()=>s.begin(11,"b",size),error=>error.reason==="busy");
  s.reply(11,"a",header()); await promise;
});
test("timeout releases the render slot and a delayed acknowledgement cannot satisfy the next job",async()=>{
  const s=new ExportRenderSession();
  await assert.rejects(s.begin(11,"old",size,5),error=>error.reason==="timeout");
  const next=s.begin(11,"new",size);
  assert.equal(s.reply(11,"old",header()),false); s.reply(11,"new",header()); await next;
});
test("window invalidation cancels outstanding rendering with no accepted late response",async()=>{
  const s=new ExportRenderSession(), promise=s.begin(11,"a",size);
  s.cancel("unavailable"); await assert.rejects(promise,error=>error.reason==="unavailable");
  assert.equal(s.reply(11,"a",header()),false); s.cancel();
});
