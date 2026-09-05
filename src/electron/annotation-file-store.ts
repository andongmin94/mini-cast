import { open } from "node:fs/promises";
import path from "node:path";
import { writeFile } from "atomically";
import {
  ANNOTATION_FILE_EXTENSION, AnnotationFileError, MAX_ANNOTATION_FILE_BYTES, parseAnnotationFile,
} from "../annotation/document-file.js";

function validatePath(filePath: string) {
  if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== `.${ANNOTATION_FILE_EXTENSION}`)
    throw new AnnotationFileError("invalid-file");
}

/** Read through one file handle, with a hard allocation limit even if the file grows. */
export async function loadAnnotationFile(filePath: string, cancelled: () => boolean = () => false) {
  validatePath(filePath);
  const handle = await open(filePath, "r");
  try {
    const initial = await handle.stat();
    if (!initial.isFile() || initial.size < 1) throw new AnnotationFileError("invalid-file");
    if (initial.size > MAX_ANNOTATION_FILE_BYTES) throw new AnnotationFileError("too-large");
    const bytes = Buffer.alloc(initial.size + 1);
    let total = 0;
    while (total < bytes.length) {
      if (cancelled()) throw new AnnotationFileError("unavailable");
      const result = await handle.read(bytes, total, Math.min(64 * 1024, bytes.length - total), total);
      if (result.bytesRead === 0) break;
      total += result.bytesRead;
    }
    const final = await handle.stat();
    if (total !== initial.size || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs || final.ctimeMs !== initial.ctimeMs)
      throw new AnnotationFileError("read-failed");
    if (cancelled()) throw new AnnotationFileError("unavailable");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, total)); }
    catch { throw new AnnotationFileError("invalid-file"); }
    return parseAnnotationFile(text);
  } finally { await handle.close(); }
}

/** Native-dialog-selected destinations only; atomic replacement preserves previous files on failure. */
export async function saveAnnotationFile(filePath: string, serialized: string) {
  validatePath(filePath);
  // Validate before touching an existing destination, including direct module callers.
  parseAnnotationFile(serialized);
  await writeFile(filePath, serialized, { timeout: 1000 });
}
