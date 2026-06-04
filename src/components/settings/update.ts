export interface ReleaseInfo {
  version: string;
  downloadUrl: string;
}

export type AppInstallMode = "portable" | "msi" | "unknown";

export interface RuntimeUpdateInfo {
  installMode: AppInstallMode;
  arch?: string | null;
  platform?: string | null;
}

const DEFAULT_UPDATE_INFO_URL =
  "https://api.github.com/repos/andongmin94/mini-cast/releases/latest";
const DEFAULT_DOWNLOAD_URL =
  "https://github.com/andongmin94/mini-cast/releases/latest";

export const UPDATE_INFO_URL =
  import.meta.env.VITE_UPDATE_INFO_URL ?? DEFAULT_UPDATE_INFO_URL;
export const UPDATE_DOWNLOAD_URL =
  import.meta.env.VITE_UPDATE_DOWNLOAD_URL ?? DEFAULT_DOWNLOAD_URL;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(
  source: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "").split("+")[0];
}

function normalizeRuntimeInfo(
  runtimeInfo?: RuntimeUpdateInfo,
): RuntimeUpdateInfo {
  const installMode =
    runtimeInfo?.installMode === "portable" ||
    runtimeInfo?.installMode === "msi"
      ? runtimeInfo.installMode
      : "unknown";

  return {
    installMode,
    arch: runtimeInfo?.arch ?? null,
    platform: runtimeInfo?.platform ?? null,
  };
}

function getAssets(payload: Record<string, unknown>) {
  const rawAssets = payload.assets;
  if (!Array.isArray(rawAssets)) {
    return [] as Array<{ name: string; url: string }>;
  }

  return rawAssets.flatMap((rawAsset) => {
    if (!isObject(rawAsset)) {
      return [];
    }
    const name = getStringField(rawAsset, ["name"]);
    const url = getStringField(rawAsset, ["browser_download_url", "url"]);
    if (!name || !url) {
      return [];
    }
    return [{ name, url }];
  });
}

function matchesAssetArch(name: string, arch?: string | null) {
  if (!arch) {
    return true;
  }

  const normalizedName = name.toLowerCase();
  const hasX64 =
    normalizedName.includes("x64") ||
    normalizedName.includes("amd64") ||
    normalizedName.includes("win64");
  const hasArm64 =
    normalizedName.includes("arm64") || normalizedName.includes("aarch64");
  const hasIa32 =
    normalizedName.includes("ia32") || normalizedName.includes("x86");

  if (hasX64) {
    return arch === "x64";
  }
  if (hasArm64) {
    return arch === "arm64";
  }
  if (hasIa32) {
    return arch === "ia32";
  }

  return true;
}

function pickAssetDownloadUrl(
  payload: Record<string, unknown>,
  runtimeInfo?: RuntimeUpdateInfo,
) {
  const runtime = normalizeRuntimeInfo(runtimeInfo);
  const assets = getAssets(payload);

  if (runtime.installMode === "portable") {
    const portableAsset = assets.find((asset) => {
      const name = asset.name.toLowerCase();
      return name.endsWith(".exe") && matchesAssetArch(name, runtime.arch);
    });
    if (portableAsset) {
      return portableAsset.url;
    }
  }

  if (runtime.installMode === "msi") {
    const msiAsset = assets.find((asset) => {
      const name = asset.name.toLowerCase();
      return name.endsWith(".msi") && matchesAssetArch(name, runtime.arch);
    });
    if (msiAsset) {
      return msiAsset.url;
    }
  }

  return null;
}

function parseSemver(version: string) {
  const normalized = normalizeVersion(version);
  const [corePart, prereleasePart] = normalized.split("-", 2);
  const core = corePart
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));

  return {
    core,
    prerelease: prereleasePart ?? null,
  };
}

export function compareVersions(currentVersion: string, nextVersion: string) {
  const current = parseSemver(currentVersion);
  const next = parseSemver(nextVersion);

  const length = Math.max(current.core.length, next.core.length);
  for (let i = 0; i < length; i += 1) {
    const currentNumber = current.core[i] ?? 0;
    const nextNumber = next.core[i] ?? 0;
    if (nextNumber > currentNumber) {
      return 1;
    }
    if (nextNumber < currentNumber) {
      return -1;
    }
  }

  if (current.prerelease && !next.prerelease) {
    return 1;
  }
  if (!current.prerelease && next.prerelease) {
    return -1;
  }

  return 0;
}

export function parseReleaseInfo(
  payload: unknown,
  runtimeInfo?: RuntimeUpdateInfo,
): ReleaseInfo | null {
  if (typeof payload === "string" && payload.trim()) {
    return {
      version: payload.trim(),
      downloadUrl: UPDATE_DOWNLOAD_URL,
    };
  }

  if (!isObject(payload)) {
    return null;
  }

  const version = getStringField(payload, [
    "version",
    "latestVersion",
    "tag_name",
    "tag",
  ]);
  if (!version) {
    return null;
  }

  const preferredDownloadUrl = pickAssetDownloadUrl(payload, runtimeInfo);
  const downloadUrl =
    preferredDownloadUrl ??
    getStringField(payload, [
      "downloadUrl",
      "releaseUrl",
      "html_url",
      "browser_download_url",
      "url",
      "homepage",
    ]) ??
    UPDATE_DOWNLOAD_URL;

  return {
    version,
    downloadUrl,
  };
}
