"""One-run source preparation; removed by the reused verification job before commit.
The current workflow remains manual-only. No branches or public releases are created.
"""
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

def git(*args):
    return subprocess.check_output(["git", *args])

def blob_id(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()

if os.environ.get("GITHUB_REPOSITORY") != REPOSITORY:
    raise RuntimeError("Unexpected repository")
if git("branch", "--show-current").decode().strip() != "main":
    raise RuntimeError("Preparation must run on main")
if git("status", "--porcelain").strip():
    raise RuntimeError("Refusing to modify a dirty checkout")

payload = bytearray()
for sha in PARTS:
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/git/blobs/{sha}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "MiniCast-Source-Verification"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        blob = json.load(response)
    data = base64.b64decode(blob["content"])
    if blob_id(data) != sha:
        raise RuntimeError("Git blob checksum mismatch")
    payload.extend(data)
if hashlib.sha256(payload).hexdigest() != EXPECTED_PAYLOAD:
    raise RuntimeError("Source transport checksum mismatch")
manifest = json.loads(lzma.decompress(payload))
if len(manifest["files"]) != 33:
    raise RuntimeError("Unexpected source change count")

# Validate every baseline and every reconstructed output before writing any file.
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
for name, output in prepared.items():
    target = Path(name)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(output)

# This is a feature increment, not an automatic release or a dependency upgrade.
for name in ("package.json", "package-lock.json"):
    target = Path(name)
    data = json.loads(target.read_text(encoding="utf-8"))
    if data["version"] != "0.3.5":
        raise RuntimeError("Unexpected package version")
    data["version"] = "0.4.0"
    if name == "package-lock.json":
        data["packages"][""]["version"] = "0.4.0"
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
# The historical runner's explicit staging list omits the lockfile.
subprocess.run(["git", "add", "package-lock.json"], check=True)
readme = Path("README.md")
text = readme.read_text(encoding="utf-8")
text = text.replace("- 펜 · 형광펜 · 요소 지우개\n", "- 펜 · 형광펜 · 요소 지우개\n- 직선 · 화살표 · 사각형 · 타원 · 한글/여러 줄 텍스트\n", 1)
text += "\n도형의 Shift 보정과 텍스트 배치 방법은 [도형·텍스트 가이드](docs/ANNOTATION-TOOLS.md)를 참고합니다.\n"
readme.write_text(text, encoding="utf-8", newline="\n")
changelog = Path("docs/CHANGELOG.md")
text = changelog.read_text(encoding="utf-8")
heading, rest = text.split("\n", 1)
changelog.write_text(heading + "\n\n## 0.4.0 도형과 텍스트\n\n직선·화살표·사각형·타원과 컨트롤러에서 작성한 텍스트를 화면에 배치합니다. 모든 도구를 같은 문서·지우개·Undo/Redo·변경분 동기화·부분 렌더링에서 처리합니다. 텍스트 입력 포커스에서는 판서 단축키를 중지합니다. 자세한 범위는 [도구 가이드](ANNOTATION-TOOLS.md)를 참고합니다.\n" + rest, encoding="utf-8", newline="\n")

# Correct the reused runner's historical commit title, only inside this fresh runner.
hook = Path(git("rev-parse", "--git-path", "hooks/prepare-commit-msg").decode().strip())
hook.parent.mkdir(parents=True, exist_ok=True)
hook.write_text('#!/bin/sh\nprintf "%s\\n" "feat: add integrated shape and text annotation tools (0.4.0)" > "$1"\n', encoding="utf-8", newline="\n")
hook.chmod(0o755)
Path("verification-logs").mkdir(exist_ok=True)
Path("verification-logs/source-preparation.json").write_text(json.dumps({"base": manifest["base"], "checkout": git("rev-parse", "HEAD").decode().strip(), "version": "0.4.0", "files": {name: hashlib.sha256(data).hexdigest() for name, data in prepared.items()}}, indent=2), encoding="utf-8")
print("Prepared 33 checksum-verified shape/text files. Full Windows verification must pass before publication.")
