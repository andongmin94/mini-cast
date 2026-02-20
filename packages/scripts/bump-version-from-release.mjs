import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OWNER = "andongmin94";
const REPO = "mini-cast";

function parseSemver(input) {
  const normalized = String(input).trim().replace(/^v/i, "");
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid semver: ${input}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatSemver(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function bumpPatch(version) {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch + 1,
  };
}

async function getLatestReleaseTag() {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "mini-cast-version-bump",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to fetch latest release (${response.status} ${response.statusText}): ${body.slice(0, 300)}`,
    );
  }

  const payload = await response.json();
  if (!payload?.tag_name) {
    throw new Error("Latest release response does not include tag_name");
  }

  return payload.tag_name;
}

async function updateJsonVersion(filePath, nextVersion) {
  const raw = await readFile(filePath, "utf8");
  const json = JSON.parse(raw);
  json.version = nextVersion;
  await writeFile(filePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

async function updateCargoTomlVersion(filePath, nextVersion) {
  const raw = await readFile(filePath, "utf8");
  const match = raw.match(/^version\s*=\s*"(\d+\.\d+\.\d+)"/m);
  if (!match) {
    throw new Error(`Could not find package version in ${filePath}`);
  }

  if (match[1] === nextVersion) {
    return;
  }

  const updated = raw.replace(
    /^version\s*=\s*"\d+\.\d+\.\d+"/m,
    `version = "${nextVersion}"`,
  );
  await writeFile(filePath, updated, "utf8");
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, "..");

  const latestTag = await getLatestReleaseTag();
  const latestVersion = parseSemver(latestTag);
  const nextVersion = formatSemver(bumpPatch(latestVersion));

  await Promise.all([
    updateJsonVersion(path.join(rootDir, "package.json"), nextVersion),
    updateJsonVersion(
      path.join(rootDir, "src-tauri", "tauri.conf.json"),
      nextVersion,
    ),
    updateCargoTomlVersion(
      path.join(rootDir, "src-tauri", "Cargo.toml"),
      nextVersion,
    ),
  ]);

  console.log(`latest release: ${formatSemver(latestVersion)}`);
  console.log(`next build version: ${nextVersion}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
