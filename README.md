<div align="center">

<a href="https://mini-cast.andongmin.com">
<img src="https://mini-cast.andongmin.com/logo.svg" alt="logo" height="200" />
</a>

</div>

# 미니캐스트 (MiniCast)

미니캐스트는 키보드와 마우스 입력을 실시간 오버레이로 화면에 표시해 주는 Tauri 기반 데스크톱 애플리케이션입니다.

강의, 라이브 코딩, 데모, 스트리밍 등 화면을 공유하는 상황에서 **지금 어떤 키를 누르고 있는지, 마우스를 어디에서 클릭했는지**를 시청자에게 직관적으로 전달합니다. 별도의 설정 없이 실행만 하면 바로 사용할 수 있도록 설계되어 있습니다.

## 핵심 기능

- **마우스 커서 하이라이트** — 커서 주변에 원형 하이라이트를 표시합니다. 색상, 투명도, 크기, 테두리를 자유롭게 조절할 수 있습니다.
- **클릭 시각화** — 좌/중/우 버튼의 클릭 상태를 시각적으로 보여줍니다.
- **키 입력 오버레이** — 현재 누르고 있는 키를 화면에 표시합니다. 조합키도 지원하며, 표시 위치·지속시간·폰트 크기를 설정할 수 있습니다.
- **다중 모니터 지원** — 연결된 모니터마다 개별 오버레이를 생성하고, 키 입력을 표시할 모니터를 선택할 수 있습니다.
- **트레이 기반 동작** — 시스템 트레이에서 실행과 숨김을 간편하게 제어합니다.
- **설정 자동 저장** — 변경한 설정은 `store.json` 파일에 자동으로 저장되어, 다음 실행 시에도 그대로 유지됩니다.

## 기술 스택

| 영역 | 사용 기술 |
|------|-----------|
| 런타임 | Tauri 2 (Rust + Webview) |
| 프론트엔드 | React 19, Vite 7, TypeScript 5, Tailwind CSS 4 |
| 입력 처리 | `rdev` + Windows fallback polling (`GetAsyncKeyState`) |

## 프로젝트 구조

아래는 주요 디렉터리 구성입니다. 앱 소스 코드는 `packages/` 아래에 위치합니다.

```text
mini-cast/
├─ docs/                # VitePress 기반 문서 사이트
└─ packages/            # 앱 소스 코드
   ├─ src/              # React UI (Controller / Overlay)
   ├─ src-tauri/        # Rust 백엔드 (윈도우·입력·트레이·저장)
   ├─ scripts/          # 버전 동기화 스크립트
   └─ package.json
```

## 개발 환경 실행

개발 모드로 앱을 실행하려면 아래 사전 요구 사항이 필요합니다.

- **Node.js** LTS 버전
- **Rust** 툴체인
- **Windows WebView2 Runtime** (Windows 10 이상에서는 대부분 기본 설치되어 있습니다)

환경이 준비되었다면 다음 명령어로 개발 서버를 시작할 수 있습니다.

```bash
cd packages
npm install
npm run tauri:dev
```

## 빌드

프로덕션 빌드는 아래 명령어로 수행합니다.

```bash
cd packages
npm run tauri:build
```

빌드와 관련하여 알아두면 좋은 사항입니다.

- `tauri:build`는 빌드 전에 `version:sync-release`를 자동 실행하여, 최신 GitHub 릴리즈를 기준으로 다음 patch 버전을 결정합니다.
- 로컬에서 단순히 현재 버전 그대로 빌드하고 싶다면 `npx tauri build`를 직접 사용하시면 됩니다.
- 현재 릴리즈 배포는 Windows `.exe` 기준으로 운영되고 있습니다.

## 문서 로컬 실행

문서 사이트를 로컬에서 미리 확인하려면 아래 명령어를 사용합니다.

```bash
cd docs
npm install
npm run docs
```

정적 빌드가 필요한 경우에는 다음 명령어를 실행합니다.

```bash
cd docs
npm run docs-build
```

## 설정 저장 위치

사용자가 변경한 설정 값은 앱 데이터 디렉터리 내 `store.json` 파일에 저장됩니다. 저장 로직의 Rust 구현은 `packages/src-tauri/src/lib.rs`에서 확인할 수 있습니다.

## 참고 링크

- 문서 사이트: https://mini-cast.andongmin.com
- GitHub Releases: https://github.com/andongmin94/mini-cast/releases

