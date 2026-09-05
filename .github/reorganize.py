"""One-run reviewed resize handle refinement; removed after successful verification."""
from pathlib import Path, PurePosixPath
import base64
import hashlib
import json
import os
import subprocess
import urllib.request

REPOSITORY = "andongmin94/mini-cast"
BASE = "db5be6fd205d356ded973bdac94d4af293df9ff7"
EDITS = ["65046dd125b6502d4fdd6de8d83a8160d7dc1433", "3a9f35c9cdca1e655d0f29588808800df66bb4c3"]

def git(*args):
    return subprocess.check_output(["git", *args])

def read_api(path):
    request = urllib.request.Request(f"https://api.github.com/repos/{REPOSITORY}/{path}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "MiniCast-Reviewed-Source"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

def read_edit(sha):
    data = base64.b64decode(read_api("git/blobs/" + sha)["content"])
    if hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest() != sha:
        raise RuntimeError("Source edit checksum mismatch")
    return json.loads(data)

if os.environ.get("GITHUB_REPOSITORY") != REPOSITORY or git("branch", "--show-current").decode().strip() != "main":
    raise RuntimeError("Unexpected repository or branch")
if git("status", "--porcelain").strip():
    raise RuntimeError("Refusing a dirty checkout")
if json.loads(Path("package.json").read_text(encoding="utf-8"))["version"] != "0.6.0":
    raise RuntimeError("Unexpected application version")
tree = read_api("git/trees/" + BASE + "?recursive=1")
if tree.get("truncated"):
    raise RuntimeError("Incomplete baseline tree")
baseline = {item["path"]: item["sha"] for item in tree["tree"] if item["type"] == "blob"}
prepared = {}
for sha in EDITS:
    for edit in read_edit(sha)["edits"]:
        name = edit["path"]
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or path.parts[0] not in {"src", "tests", "docs", "scripts"}:
            raise RuntimeError("Unexpected edit destination")
        if name not in prepared:
            if name not in baseline or git("rev-parse", "HEAD:" + name).decode().strip() != baseline[name]:
                raise RuntimeError("Source changed since review: " + name)
            prepared[name] = git("show", "HEAD:" + name).decode("utf-8")
        source = prepared[name]
        for old, new in edit.get("replacements", []):
            if source.count(old) != 1:
                raise RuntimeError("Exact reviewed target changed: " + name + " " + old[:80])
            source = source.replace(old, new, 1)
        prepared[name] = source + edit.get("append", "")
for name, source in prepared.items():
    Path(name).write_text(source, encoding="utf-8", newline="\n")
hook = Path(git("rev-parse", "--git-path", "hooks/prepare-commit-msg").decode().strip())
hook.parent.mkdir(parents=True, exist_ok=True)
hook.write_text('#!/bin/sh\nprintf "%s\\n" "fix: keep resize handles visible for tiny and edge selections" > "$1"\n', encoding="utf-8", newline="\n")
hook.chmod(0o755)
Path("verification-logs").mkdir(exist_ok=True)
Path("verification-logs/source-preparation.json").write_text(json.dumps({
    "base": BASE, "checkout": git("rev-parse", "HEAD").decode().strip(), "version": "0.6.0",
    "files": {name: hashlib.sha256(source.encode()).hexdigest() for name, source in prepared.items()},
}, indent=2), encoding="utf-8")
print("Prepared reviewed resize handle geometry. Full source, native input, package and ZIP checks remain required.")
