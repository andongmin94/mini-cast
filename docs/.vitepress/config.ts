import { defineConfig, UserConfig } from "vitepress";
import { buildEnd } from "./buildEnd.config";
import { fetchLatestRelease, fetchAllReleases } from "./getReleaseData";
import { updateIndexMd } from "./updateIndexFile";
import fs from "node:fs/promises";
import path from "node:path";

const ogTitle = "미니캐스트";
const ogDescription = "쓰기 쉽게, 보기 쉽게";
const ogUrl = "https://mini-cast.andongmin.com";
const ogImage = "https://mini-cast.andongmin.com/mini-cast.svg";

async function generateReleaseNotes(releases: any) {
  const releaseDir = path.resolve(__dirname, "../guide/release");

  try {
    // 디렉토리 존재 확인 및 생성
    try {
      await fs.access(releaseDir);
    } catch {
      await fs.mkdir(releaseDir, { recursive: true });
      console.log(`📁 릴리즈 문서 디렉토리 생성: ${releaseDir}`);
    }

    // 각 릴리즈에 대한 문서 생성
    for (const release of releases) {
      const version = release.version;
      const filePath = path.join(releaseDir, `${version}.md`);

      // 릴리즈 노트 내용 포맷팅 (GitHub의 마크다운을 VitePress 호환 마크다운으로 변환)
      let content = `# ${version}\n\n`;

      // GitHub 릴리즈 본문을 파싱하여 추가
      if (release.body) {
        content += release.body
          .replace(/\r\n/g, "\n") // 줄바꿈 통일
          .trim();
      } else {
        content += `릴리즈 노트 내용이 없습니다.`;
      }

      // 파일이 없거나 내용이 다른 경우만 쓰기
      let shouldWrite = true;
      try {
        const existingContent = await fs.readFile(filePath, "utf-8");
        if (existingContent.trim() === content.trim()) {
          shouldWrite = false;
        }
      } catch {
        // 파일이 없으면 무시하고 새로 생성
      }

      if (shouldWrite) {
        await fs.writeFile(filePath, content);
        console.log(`📝 릴리즈 문서 생성: ${version}`);
      }
    }

    console.log("✅ 모든 릴리즈 문서가 업데이트되었습니다");
  } catch (error) {
    console.error("❌ 릴리즈 문서 생성 실패:", error);
  }
}

const config = async (): Promise<UserConfig> => {
  const isProd = process.env.NODE_ENV === "production";
  console.log(`현재 모드: ${isProd ? "빌드" : "개발"}`);

  let latestRelease;
  let allReleases = [];
  let releaseItems = [];

  if (isProd) {
    // 빌드 모드에서만 GitHub API 호출
    console.log("🔍 GitHub에서 최신 릴리즈 정보 가져오는 중...");
    latestRelease = await fetchLatestRelease();
    if (latestRelease)
      console.log(
        `📦 최신 릴리즈 정보: 버전 ${latestRelease.version}, 파일 크기 ${latestRelease.fileSize}MB`
      );

    // index.md 파일 업데이트
    if (latestRelease) await updateIndexMd(latestRelease);

    // 모든 릴리즈 정보 가져오기
    console.log("📚 모든 릴리즈 정보 가져오는 중...");
    allReleases = await fetchAllReleases();
    console.log(`🔢 총 ${allReleases.length}개의 릴리즈 정보를 가져왔습니다`);

    // 릴리즈 문서 자동 생성
    await generateReleaseNotes(allReleases);
  } else {
    // 개발용 더미 릴리즈 목록
    allReleases = [{ version: "v0.0.0" }];

    console.log("🧪 개발 모드: API 호출 대신 더미 데이터 사용");
  }

  // 사이드바 설정 부분을 동적으로 생성
  releaseItems = allReleases.map((release: { version: any }) => ({
    text: release.version,
    link: `/guide/release/${release.version}`,
  }));
  return {
    title: "미니캐스트",
    description: "쓰기 쉽게, 보기 쉽게",

    head: [
      ["link", { rel: "icon", type: "image/svg+xml", href: "/mini-cast.svg" }],
      [
        "link",
        { rel: "alternate", type: "application/rss+xml", href: "/blog.rss" },
      ],
      ["link", { rel: "organization", href: "https://github.com/andongmin94" }],
      ["meta", { property: "og:type", content: "website" }],
      ["meta", { property: "og:title", content: ogTitle }],
      ["meta", { property: "og:image", content: ogImage }],
      ["meta", { property: "og:url", content: ogUrl }],
      ["meta", { property: "og:description", content: ogDescription }],
      ["meta", { name: "theme-color", content: "#1170ff" }],
      [
        "script",
        {
          src: "https://cdn.usefathom.com/script.js",
          "data-site": "CBDFBSLI",
          "data-spa": "auto",
          defer: "",
        },
      ],
    ],

    themeConfig: {
      logo: "/mini-cast.svg",

      editLink: {
        pattern: "mailto:andongmin94@gmail.com",
        text: "가이드 수정 제안하기",
      },

      sidebarMenuLabel: "메뉴",

      returnToTopLabel: "위로 가기",

      darkModeSwitchLabel: "다크 모드",

      docFooter: {
        prev: "이전 페이지",
        next: "다음 페이지",
      },

      footer: {
        message: `Released under the EULA License`,
        copyright: "Copyright © 2025 안동민",
      },

      nav: [
        { text: "미니캐스트 가이드", link: "/guide", activeMatch: "/guide" },
        { text: "미니캐스트 개발자", link: "/maintainer" },
      ],

      sidebar: {
        "/guide/": [
          {
            text: "미니캐스트 가이드",
            items: [
              {
                text: "미니캐스트 시작하기",
                link: "/guide/",
              },
              {
                text: "마우스 설정",
                link: "/guide/mouse",
              },
              {
                text: "키보드 설정",
                link: "/guide/keyboard",
              },
              {
                text: "캔버스 설정",
                link: "/guide/canvas",
              },
            ],
          },
          {
            text: "릴리즈 노트",
            items: releaseItems, // 동적으로 생성된 릴리즈 항목
          },
        ],
      },

      outline: {
        level: [2, 3],
        label: "목차"    // ← 추가: 원하는 한글로 변경
      },
    },
    transformPageData(pageData: any) {
      const canonicalUrl = `${ogUrl}/${pageData.relativePath}`
        .replace(/\/index\.md$/, "/")
        .replace(/\.md$/, "/");
      pageData.frontmatter.head ??= [];
      pageData.frontmatter.head.unshift([
        "link",
        { rel: "canonical", href: canonicalUrl },
      ]);
      return pageData;
    },
    buildEnd,
  };
};

export default defineConfig(await config());
