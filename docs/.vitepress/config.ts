import { defineConfig } from "vitepress";
import { transformerTwoslash } from "@shikijs/vitepress-twoslash";
import { buildEnd } from "./buildEnd.config";

const ogDescription = "GUI Library for Desktop App Development";
const ogImage = "https://mini-cast.andongmin.com/mini-cast.svg";
const ogTitle = "미니캐스트";
const ogUrl = "https://mini-cast.andongmin.com";

export default defineConfig({
  title: "미니캐스트",
  description: "GUI Library for Desktop App Development",

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
    ["meta", { name: "theme-color", content: "#646cff" }],
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
      pattern: "https://github.com/andongmin94/mini-cast/edit/main/docs",
      text: "Suggest changes to this page",
    },

    footer: {
      message: `Released under the EULA License`,
      copyright: "Copyright © 2024 안동민",
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
        }
      ],
    },

    outline: {
      level: [2, 3],
    },
  },
  transformPageData(pageData) {
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
  markdown: {
    codeTransformers: [transformerTwoslash()],
  },
  buildEnd,
});
