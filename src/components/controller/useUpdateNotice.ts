import { useEffect, useState } from "react";

import {
  compareVersions,
  parseReleaseInfo,
  UPDATE_INFO_URL,
  type ReleaseInfo,
  type RuntimeUpdateInfo,
} from "@/components/settings/update";

type UpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "error";

interface UpdateNoticeState {
  status: UpdateStatus;
  release: ReleaseInfo | null;
  message: string | null;
}

const INITIAL_STATE: UpdateNoticeState = {
  status: "idle",
  release: null,
  message: null,
};

const UPDATE_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RUNTIME_INFO: RuntimeUpdateInfo = {
  installMode: "unknown",
  arch: null,
  platform: null,
};

function normalizeRuntimeInfo(payload: unknown): RuntimeUpdateInfo {
  if (!payload || typeof payload !== "object") {
    return DEFAULT_RUNTIME_INFO;
  }

  const source = payload as Record<string, unknown>;
  const installMode =
    source.installMode === "portable" || source.installMode === "msi"
      ? source.installMode
      : "unknown";

  return {
    installMode,
    arch: typeof source.arch === "string" ? source.arch : null,
    platform: typeof source.platform === "string" ? source.platform : null,
  };
}

async function getRuntimeInfo() {
  try {
    const payload = (await electron.get("runtimeInfo")) as unknown;
    return normalizeRuntimeInfo(payload);
  } catch {
    return DEFAULT_RUNTIME_INFO;
  }
}

async function fetchReleaseInfo(
  signal: AbortSignal,
  runtimeInfo: RuntimeUpdateInfo,
): Promise<ReleaseInfo> {
  const response = await fetch(UPDATE_INFO_URL, {
    cache: "no-store",
    signal,
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  if (
    response.status === 403 &&
    response.headers.get("x-ratelimit-remaining") === "0"
  ) {
    throw new Error(
      "GitHub API 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.",
    );
  }
  if (!response.ok) {
    throw new Error(`업데이트 서버 응답 오류 (${response.status})`);
  }

  const payload = (await response.json()) as unknown;
  const parsed = parseReleaseInfo(payload, runtimeInfo);
  if (!parsed) {
    throw new Error("업데이트 정보 형식이 올바르지 않습니다.");
  }

  return parsed;
}

export function useUpdateNotice(currentVersion: string) {
  const [state, setState] = useState<UpdateNoticeState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, UPDATE_REQUEST_TIMEOUT_MS);

    const run = async () => {
      setState((previous) => ({
        ...previous,
        status: "checking",
        message: "업데이트 확인 중...",
      }));

      try {
        const runtimeInfo = await getRuntimeInfo();
        const release = await fetchReleaseInfo(controller.signal, runtimeInfo);
        const comparison = compareVersions(currentVersion, release.version);

        if (cancelled) {
          return;
        }

        if (comparison >= 1) {
          setState({
            status: "available",
            release,
            message: `새 버전 ${release.version}이 있습니다.`,
          });
          return;
        }

        setState({
          status: "up-to-date",
          release: null,
          message: null,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error && error.message
            ? error.message
            : "업데이트 확인에 실패했습니다.";
        setState({
          status: "error",
          release: null,
          message,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    void run();

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [currentVersion]);

  return {
    status: state.status,
    release: state.release,
    message: state.message,
  };
}
