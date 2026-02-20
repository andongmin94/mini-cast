import fs from "node:fs/promises";
import path from "node:path";

type AssetInfo = {
  name: string;
  url: string;
  sizeMB: number;
  ext: string | undefined;
};

export interface ReleaseData {
  version: string;
  fileSize: number;
  downloadUrl: string;
  body: string;
  publishedAt?: string;
  assets?: {
    exe: AssetInfo | null;
  };
}

const RELEASES_API = "https://api.github.com/repos/andongmin94/mini-cast/releases";
const LATEST_RELEASE_API = `${RELEASES_API}/latest`;
const REQUEST_HEADERS = { "User-Agent": "mini-cast-docs" };

function normalizeVersion(tagName: string): string {
  return tagName.replace("mini-cast-", "");
}

function mapAsset(asset: any): AssetInfo | null {
  if (!asset) return null;
  return {
    name: asset.name,
    url: asset.browser_download_url,
    sizeMB: Math.round(asset.size / 1024 / 1024),
    ext: asset.name.split(".").pop(),
  };
}

export async function fetchLatestRelease(): Promise<ReleaseData | undefined> {
  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: REQUEST_HEADERS,
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const assets = data.assets || [];
    const exe = mapAsset(assets.find((a: any) => a.name.endsWith(".exe")));
    const primary = exe || { url: "", sizeMB: 0 };

    return {
      version: normalizeVersion(data.tag_name),
      downloadUrl: primary.url,
      fileSize: primary.sizeMB,
      body: data.body || "",
      publishedAt: data.published_at,
      assets: { exe },
    };
  } catch (error) {
    console.error("Failed to fetch latest release:", error);
    return undefined;
  }
}

export async function fetchAllReleases(): Promise<ReleaseData[]> {
  try {
    const response = await fetch(RELEASES_API, {
      headers: REQUEST_HEADERS,
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const releases = await response.json();
    return releases.map(
      (release: {
        tag_name: string;
        assets: any[];
        body: string;
        published_at: string;
      }) => {
        const exe = release.assets.find((a: any) => a.name.endsWith(".exe"));
        return {
          version: normalizeVersion(release.tag_name),
          downloadUrl: exe ? exe.browser_download_url : "",
          fileSize: exe ? Math.round(exe.size / 1024 / 1024) : 0,
          body: release.body || "",
          publishedAt: release.published_at,
        };
      }
    );
  } catch (error) {
    console.error("Failed to fetch release list:", error);
    return [];
  }
}

function buildWindowsBlocks(releaseData: ReleaseData): string {
  const blocks: string[] = [];
  const { assets } = releaseData;
  if (!assets) return "";

  if (assets.exe) {
    blocks.push(
`  - icon:
      dark: /windows-white.svg
      light: /windows-black.svg
      width: 100px
    title: Windows 다운로드
    linkText: 무설치판 (${assets.exe.sizeMB} MB)
    link: ${assets.exe.url}`
    );
  }

  return [
    "# WINDOWS_DOWNLOADS_START (자동 생성 영역: release.ts)",
    ...blocks,
    "# WINDOWS_DOWNLOADS_END",
  ].join("\n\n");
}

export async function updateIndexMd(releaseData: ReleaseData): Promise<void> {
  try {
    const indexPath = path.resolve(__dirname, "..", "index.md");
    let content = await fs.readFile(indexPath, "utf-8");

    content = content.replace(
      /(^\s*name:\s*.+?)v?[0-9]+\.[0-9]+\.[0-9]+/m,
      `$1${releaseData.version}`
    );

    if (!/# WINDOWS_DOWNLOADS_START/.test(content)) {
      console.warn(
        "WINDOWS_DOWNLOADS_START marker was not found, skipping section update."
      );
      await fs.writeFile(indexPath, content);
      return;
    }

    const windowsSection = buildWindowsBlocks(releaseData);
    content = content.replace(
      /# WINDOWS_DOWNLOADS_START[\s\S]*?# WINDOWS_DOWNLOADS_END/,
      windowsSection
    );

    await fs.writeFile(indexPath, content);
    console.log("index.md download section updated.");
  } catch (error) {
    console.error("Failed to update index.md:", error);
  }
}

export async function generateReleaseNotes(releases: ReleaseData[]): Promise<void> {
  const releaseDir = path.resolve(__dirname, "../guide/release");

  try {
    await fs.mkdir(releaseDir, { recursive: true });

    for (const release of releases) {
      const version = release.version;
      const filePath = path.join(releaseDir, `${version}.md`);
      const body = release.body?.replace(/\r\n/g, "\n").trim();
      const content = `# ${version}\n\n${body || "릴리즈 노트 내용이 없습니다."}`;

      let shouldWrite = true;
      try {
        const existingContent = await fs.readFile(filePath, "utf-8");
        if (existingContent.trim() === content.trim()) {
          shouldWrite = false;
        }
      } catch {
        // File does not exist yet.
      }

      if (shouldWrite) {
        await fs.writeFile(filePath, content);
      }
    }

    console.log("Release notes generated.");
  } catch (error) {
    console.error("Failed to generate release notes:", error);
  }
}
