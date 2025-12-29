import fs from "node:fs/promises";
import path from "node:path";

interface ReleaseData {
  version: string;
  fileSize: number;
  downloadUrl: string;
  assets?: {
    exe: { name: string; url: string; sizeMB: number; ext: string } | null;
    msi: { name: string; url: string; sizeMB: number; ext: string } | null;
  };
}

function buildWindowsBlocks(releaseData: ReleaseData) {
  const blocks: string[] = [];
  const { assets } = releaseData;
  if (!assets) return "";

  // 출력 순서 원하는 대로 (msi 먼저면 순서 바꾸기)
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
  if (assets.msi) {
    blocks.push(
`  - icon:
      dark: /windows-white.svg
      light: /windows-black.svg
      width: 100px
    title: Windows 다운로드
    linkText: .msi 설치형 (${assets.msi.sizeMB} MB)
    link: ${assets.msi.url}`
    );
  }


  return [
    "# WINDOWS_DOWNLOADS_START (자동 생성 영역: updateIndexFile.ts 가 덮어씀)",
    ...blocks,
    "# WINDOWS_DOWNLOADS_END"
  ].join("\n\n");
}

async function updateIndexMd(releaseData: ReleaseData) {
  try {
    const indexPath = path.resolve(__dirname, "..", "index.md");
    let content = await fs.readFile(indexPath, "utf-8");

    // 버전명 갱신
    content = content.replace(
      /name: 미니캐스트 v?[0-9]+\.[0-9]+\.[0-9]+/,
      `name: 미니캐스트 ${releaseData.version}`
    );

    // Windows 블럭 마커 존재 여부 확인
    if (!/# WINDOWS_DOWNLOADS_START/.test(content)) {
      console.warn("⚠️ WINDOWS_DOWNLOADS_START 마커가 없어 자동 갱신을 건너뜁니다.");
      await fs.writeFile(indexPath, content);
      return;
    }

    const windowsSection = buildWindowsBlocks(releaseData);

    content = content.replace(
      /# WINDOWS_DOWNLOADS_START[\s\S]*?# WINDOWS_DOWNLOADS_END/,
      windowsSection
    );

    await fs.writeFile(indexPath, content);
    console.log("✅ index.md (exe/msi) 갱신 완료");
  } catch (error) {
    console.error("❌ index.md 업데이트 실패:", error);
  }
}

export { updateIndexMd };