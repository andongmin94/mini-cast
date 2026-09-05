"""Prepare the reviewed 0.4.0 sources; the verification job removes this file before commit."""
from pathlib import Path, PurePosixPath
import base64
import hashlib
import json
import lzma
import os
import subprocess
import urllib.request

REPOSITORY = "andongmin94/mini-cast"
PARTS = [
    "904af81f7befae03959a3145bbf6f88938f5961b",
    "5e19a70a273e123f9469f628c280b00b51a0bc7c",
    "63b4d5edc3355e64321fb4039183e046ec975124",
    "823b3057e9fc13552380c52ab53c249a4082e76b",
]
EXPECTED_PAYLOAD = "5246c8a3828a5f2c8aa916d137bea13861a4652c4579b0961aebb1245c801ceb"
EXTRA_EDITS = ["69254499f91ac716ab633da964d16d0089e1f54a"]


def git(*args):
    return subprocess.check_output(["git", *args])


def blob_id(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def fetch_blob(sha):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/git/blobs/{sha}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "MiniCast-Source-Verification"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        blob = json.load(response)
    data = base64.b64decode(blob["content"])
    if blob_id(data) != sha:
        raise RuntimeError("Git blob checksum mismatch")
    return data


if os.environ.get("GITHUB_REPOSITORY") != REPOSITORY:
    raise RuntimeError("Unexpected repository")
if git("branch", "--show-current").decode().strip() != "main":
    raise RuntimeError("Preparation must run on main")
if git("status", "--porcelain").strip():
    raise RuntimeError("Refusing to modify a dirty checkout")
payload = b"".join(fetch_blob(sha) for sha in PARTS)
if hashlib.sha256(payload).hexdigest() != EXPECTED_PAYLOAD:
    raise RuntimeError("Source transport checksum mismatch")
manifest = json.loads(lzma.decompress(payload))
if len(manifest["files"]) != 33:
    raise RuntimeError("Unexpected source change count")

prepared = {}
for item in manifest["files"]:
    name = item["path"]
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or path.parts[0] not in {"src", "tests", "scripts", "docs"}:
        raise RuntimeError("Unexpected destination")
    if item["before"] is None:
        if Path(name).exists():
            raise RuntimeError("New destination already exists: " + name)
        original = b""
    else:
        original = git("show", "HEAD:" + name)
        if blob_id(original) != item["before"]:
            raise RuntimeError("Source changed since review: " + name)
    lines = original.decode("utf-8").splitlines(keepends=True)
    output = "".join("".join(lines[op[0]:op[1]]) if isinstance(op, list) else op for op in item["ops"]).encode("utf-8")
    if hashlib.sha256(output).hexdigest() != item["after"]:
        raise RuntimeError("Reconstructed source checksum mismatch: " + name)
    prepared[name] = output


def replace_once(name, old, new):
    source = prepared[name].decode("utf-8")
    if source.count(old) != 1:
        raise RuntimeError("Reviewed edit target changed: " + name + " / " + old[:80])
    prepared[name] = source.replace(old, new, 1).encode("utf-8")


replace_once("src/annotation/text.ts", r"/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)", "hasUnsupportedControlCharacters(text)")
marker = "/** Plain text only; no HTML, persisted draft, or font/URL supplied over IPC. */"
helper = """/** Newlines are allowed; tabs and CR are normalized before this check. */
function hasUnsupportedControlCharacters(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if ((code < 32 && code !== 10) || code === 127) return true;
  }
  return false;
}

"""
replace_once("src/annotation/text.ts", marker, helper + marker)
prepared["tests/unit/annotation/shapes-and-text.test.mjs"] += b'\n' + """test("text control-character policy preserves normalized whitespace and rejects every other C0 code", () => {
  for (let code = 0; code < 32; code += 1) {
    const result = readAnnotationTextDraft({ text: "A" + String.fromCharCode(code) + "B", fontSize: 28 });
    assert.equal(result !== null, [9, 10, 13].includes(code), `C0 code ${code}`);
  }
  assert.equal(readAnnotationTextDraft({ text: "A" + String.fromCharCode(127) + "B", fontSize: 28 }), null);
});
""".encode("utf-8")
for sha in EXTRA_EDITS:
    edit = json.loads(fetch_blob(sha))
    for old, new in edit["replacements"]:
        replace_once(edit["path"], old, new)

# Windows layered-window hit testing passes through pixels whose alpha is zero.
# Keep this input plane independent of both the cursor and highlighter opacity.
# The drawing canvases remain transparent; pass-through removes the input plane.
replace_once("src/renderer/components/Overlay.tsx", "style={{ zIndex: 9999 }}", """style={{
        zIndex: 9999,
        // A zero-alpha layered window can miss native pointer input on Windows.
        // One alpha step keeps blank areas hit-testable without painting the document.
        backgroundColor: passive ? "transparent" : "rgba(0, 0, 0, 0.004)",
      }}""")
prepared["docs/ANNOTATION-TOOLS.md"] += "\n판서 모드에서는 Windows가 빈 투명 영역에도 입력을 전달하도록 1/255에 가까운 최소 알파 배경을 사용합니다. 이 배경은 판서 문서나 Canvas 픽셀에 저장되지 않으며 조작 모드에서는 제거됩니다.\n".encode("utf-8")

for name, output in prepared.items():
    target = Path(name)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(output)

# Retain the exact relevant source in this verification log, not another repository directory.
for name, begin, end in [
    ("src/renderer/components/AnnotationSurface.tsx", "  function handlePointerDown", "  return ("),
    ("src/electron/testing/interaction-smoke.ts", "  async function verifyShapeAndTextTools", "  async function measureAnnotationPipeline"),
]:
    source = prepared[name].decode("utf-8")
    start = source.find(begin)
    finish = source.find(end, start + len(begin))
    if start >= 0:
        snippet = source[start:finish if finish > start else start + 18000]
        print("SOURCE_REVIEW " + name + "\n" + snippet.encode("ascii", errors="backslashreplace").decode("ascii"))

for name in ("package.json", "package-lock.json"):
    target = Path(name)
    data = json.loads(target.read_text(encoding="utf-8"))
    if data["version"] != "0.3.5":
        raise RuntimeError("Unexpected package version")
    data["version"] = "0.4.0"
    if name == "package-lock.json":
        data["packages"][""]["version"] = "0.4.0"
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
subprocess.run(["git", "add", "package-lock.json"], check=True)
readme = Path("README.md")
text = readme.read_text(encoding="utf-8")
text = text.replace("- 펜 · 형광펜 · 요소 지우개\n", "- 펜 · 형광펜 · 요소 지우개\n- 직선 · 화살표 · 사각형 · 타원 · 한글/여러 줄 텍스트\n", 1)
text += "\n도형의 Shift 보정과 텍스트 배치 방법은 [도형·텍스트 가이드](docs/ANNOTATION-TOOLS.md)를 참고합니다.\n"
readme.write_text(text, encoding="utf-8", newline="\n")
changelog = Path("docs/CHANGELOG.md")
heading, rest = changelog.read_text(encoding="utf-8").split("\n", 1)
changelog.write_text(heading + "\n\n## 0.4.0 도형과 텍스트\n\n직선·화살표·사각형·타원과 컨트롤러에서 작성한 텍스트를 화면에 배치합니다. 모든 도구를 같은 문서·지우개·Undo/Redo·변경분 동기화·부분 렌더링에서 처리합니다. 텍스트 입력 포커스에서는 판서 단축키를 중지합니다. 빈 영역의 입력은 커서 그림에 의존하지 않습니다. 자세한 범위는 [도구 가이드](ANNOTATION-TOOLS.md)를 참고합니다.\n" + rest, encoding="utf-8", newline="\n")
hook = Path(git("rev-parse", "--git-path", "hooks/prepare-commit-msg").decode().strip())
hook.parent.mkdir(parents=True, exist_ok=True)
hook.write_text('#!/bin/sh\nprintf "%s\\n" "feat: add integrated shape and text annotation tools (0.4.0)" > "$1"\n', encoding="utf-8", newline="\n")
hook.chmod(0o755)
Path("verification-logs").mkdir(exist_ok=True)
Path("verification-logs/source-preparation.json").write_text(json.dumps({"base": manifest["base"], "checkout": git("rev-parse", "HEAD").decode().strip(), "version": "0.4.0", "files": {name: hashlib.sha256(data).hexdigest() for name, data in prepared.items()}}, indent=2), encoding="utf-8")
print("Prepared reviewed shape/text source with a cursor-independent input plane. Full Windows checks are required before publication.")
