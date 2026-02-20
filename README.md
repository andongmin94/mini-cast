<div align="center">

<a href="https://mini-cast.andongmin.com">
<img src="https://mini-cast.andongmin.com/logo.svg" alt="logo" height="200" />
</a>

</div>

# 미니캐스트 (MiniCast)

미니캐스트는 키보드/마우스 입력을 실시간 오버레이로 보여주는 Tauri 기반 데스크톱 앱입니다.  
강의, 라이브 코딩, 데모, 스트리밍 환경에서 현재 입력을 화면에 명확하게 전달하는 데 초점을 둡니다.

## 핵심 기능
- 마우스 커서 하이라이트(색상/투명도/크기/테두리 조절)
- 클릭 시각화(좌/중/우 버튼 상태 표시)
- 키 입력 오버레이(조합키 포함, 표시 위치/지속시간/폰트 크기 설정)
- 다중 모니터 지원(모니터별 오버레이 생성, 키 표시 모니터 선택)
- 트레이 기반 실행/숨김 동작
- 설정 영구 저장(`store.json`)

## 기술 스택
- 런타임: Tauri 2 (Rust + Webview)
- 프론트엔드: React 19, Vite 7, TypeScript 5, Tailwind CSS 4
- 입력 처리: `rdev` + Windows fallback polling(`GetAsyncKeyState`)

## 프로젝트 구조
```text
mini-cast/
├─ docs/                # VitePress 문서
└─ packages/            # 앱 코드
   ├─ src/              # React UI (Controller / Overlay)
   ├─ src-tauri/        # Rust 백엔드 (윈도우/입력/트레이/저장)
   ├─ scripts/          # 버전 동기화 스크립트
   └─ package.json
```

## 개발 실행
사전 요구 사항:
- Node.js LTS
- Rust toolchain
- Windows WebView2 Runtime

```bash
cd packages
npm install
npm run tauri:dev
```

## 빌드
```bash
cd packages
npm run tauri:build
```

- `tauri:build`는 `version:sync-release`를 먼저 실행해 최신 GitHub 릴리즈 기준으로 다음 patch 버전을 맞춘 뒤 빌드합니다.
- 단순 로컬 버전 기준 빌드가 필요하면 `npx tauri build`를 사용합니다.
- 현재 릴리즈 다운로드 문서는 Windows `.exe` 기준으로 운영합니다.

## 문서 로컬 실행
```bash
cd docs
npm install
npm run docs
```

문서 빌드:
```bash
cd docs
npm run docs-build
```

## 설정 저장 위치
- 앱 데이터 디렉터리의 `store.json`에 저장됩니다.
- Rust 구현 위치: `packages/src-tauri/src/lib.rs`

## 참고 링크
- 문서 사이트: https://mini-cast.andongmin.com
- GitHub Releases: https://github.com/andongmin94/mini-cast/releases

