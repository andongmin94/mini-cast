async function fetchLatestRelease() {
  try {
    const response = await fetch(
      "https://api.github.com/repos/andongmin94/mini-cast/releases/latest",
      {
        headers: { "User-Agent": "Node.js" },
      }
    );

    if (!response.ok) {
      throw new Error(
        `GitHub API 응답 오류: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const version = data.tag_name.replace("mini-cast-", "");
    const body = data.body || "";

    const assets = data.assets || [];

    const exeAsset = assets.find(
      (a: any) => a.name.endsWith(".exe")
    );
    const msiAsset = assets.find(
      (a: any) => a.name.endsWith(".msi") && /x64/i.test(a.name)
    );

    const makeAssetInfo = (asset: any) =>
      asset
        ? {
            name: asset.name,
            url: asset.browser_download_url,
            sizeMB: Math.round(asset.size / 1024 / 1024),
            ext: asset.name.split(".").pop(),
          }
        : null;

    const exeInfo = makeAssetInfo(exeAsset);
    const msiInfo = makeAssetInfo(msiAsset);

    // 기존 호환 필드 (우선 exe, 없으면 msi)
    const primary = exeInfo || msiInfo || { url: "", sizeMB: 0 };

    return {
      version,
      downloadUrl: primary.url,
      fileSize: primary.sizeMB,
      body,
      publishedAt: data.published_at,
      assets: {
        exe: exeInfo,
        msi: msiInfo,
      },
    };
  } catch (error) {
    console.error("GitHub 릴리즈 정보 가져오기 실패:", error);
  }
}

// 모든 릴리즈 정보 (기존 그대로, 필요시 동일 패턴 확장 가능)
async function fetchAllReleases() {
  try {
    const response = await fetch(
      "https://api.github.com/repos/andongmin94/mini-cast/releases",
      {
        headers: { "User-Agent": "Node.js" },
      }
    );

    if (!response.ok) {
      throw new Error(
        `GitHub API 응답 오류: ${response.status} ${response.statusText}`
      );
    }

    const releases = await response.json();

    return releases.map(
      (release: {
        tag_name: string;
        assets: any[];
        body: string;
        published_at: string;
      }) => {
        const version = release.tag_name.replace("mini-cast-", "");
        const exeAsset = release.assets.find((a: any) =>
          a.name.endsWith(".exe")
        );
        let downloadUrl = "";
        let fileSize = 0;
        if (exeAsset) {
          downloadUrl = exeAsset.browser_download_url;
            fileSize = Math.round(exeAsset.size / 1024 / 1024);
        }
        return {
          version,
          downloadUrl,
          fileSize,
          body: release.body || "",
          publishedAt: release.published_at,
        };
      }
    );
  } catch (error) {
    console.error("GitHub 릴리즈 정보 가져오기 실패:", error);
    return [];
  }
}

export { fetchLatestRelease, fetchAllReleases };