/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UPDATE_INFO_URL?: string;
  readonly VITE_UPDATE_DOWNLOAD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
