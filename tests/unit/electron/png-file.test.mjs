import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writePngFile } from "../../../dist/electron/png-file.js";

test("PNG writes replace whole files and leave no temporary artifacts",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"mini-cast-export-unit-"));
  try {
    const target=path.join(dir,"한글 판서.PNG"); await writeFile(target,"old");
    const payload=Uint8Array.from([137,80,78,71,1,2,3,4]);
    await writePngFile(target,payload);
    assert.deepEqual(new Uint8Array(await readFile(target)),payload);
    assert.deepEqual(await readdir(dir),["한글 판서.PNG"]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test("failed PNG publication preserves the destination and purges temporary files",async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),"mini-cast-export-failure-"));
  try {
    const target=path.join(dir,"blocked.png"); await mkdir(target); await writeFile(path.join(target,"kept"),"keep");
    await assert.rejects(writePngFile(target,new Uint8Array([1,2,3])));
    assert.equal(await readFile(path.join(target,"kept"),"utf8"),"keep");
    assert.deepEqual(await readdir(dir),["blocked.png"]);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test("relative paths and misleading file extensions cannot be used for output",async()=>{
  for(const target of ["result.png",path.join(tmpdir(),"result.exe"),path.join(tmpdir(),"result.png.txt")])
    await assert.rejects(writePngFile(target,new Uint8Array([1])));
});
