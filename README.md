<div align="center">

<a href="https://andongmin.com/mini-cast">
<img src="https://andongmin.com/mini-cast/logo.svg" alt="logo" height="200" />
</a>

</div>

# 미니캐스트 (MiniCast)

키보드 & 마우스 입력을 실시간으로 화면에 시각화(오버레이)하여 강의, 라이브 스트리밍, 발표에 도움을 주는 데스크톱 애플리케이션입니다.

다중 모니터 환경을 지원하며, 커서 하이라이트와 키 입력 표시를 세밀하게 커스터마이즈할 수 있습니다.

## 핵심 기능

- **마우스 커서 하이라이트**: 색상, 불투명도, 크기, 테두리 색/굵기 조절
- **마우스 클릭 반응**: 좌/중/우 클릭 시 테두리 강조
- **키보드 입력 표시**: 조합키(Ctrl / Shift / Alt / Meta) + 일반 키를 조합 형태로 표시 (한글 입력 중 물리 키와 한/영·한자 키 포함)
- **다중 모니터 지원**: 모든 모니터에 투명 오버레이 창 생성, 특정 모니터에만 키 입력 표시 가능
- **표시 위치 선택**: 키 입력 표시 영역을 4개 코너 중 선택 (top-left / top-right / bottom-left / bottom-right)
- **실시간 설정 반영**: 컨트롤러(UI)에서 바꾸는 즉시 오버레이에 적용 (IPC 실시간 통신)
- **설정 영구 저장**: `electron-store` 를 사용해 사용자 환경 유지
- **글로벌 입력 후킹**: `uiohook-napi` 로 별도 실행 파일 없이 전역 키/마우스 이벤트 수집
- **투명 & 포커스 비활성 오버레이**: 실제 작업 방해 없이 위에 겹쳐 표시 (`BrowserWindow` + `setIgnoreMouseEvents`)
- **Vite + React + Tailwind 기반 빠른 UI**
- **싱글 인스턴스 보장**: 중복 실행 방지 (`app.requestSingleInstanceLock`)
- **스플래시 화면**: 자원 초기화 동안 사용자 경험 향상
- **트레이 아이콘 지원**: 창을 닫아도 오버레이를 유지하고 빠르게 다시 열거나 종료

## 화면 구성

| 구성                     | 설명                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| 컨트롤러 창 (`/`)        | 설정 패널 (커서 / 키보드 탭) + 상단 커스텀 타이틀바 + 하단 광고 iframe |
| 오버레이 창 (`/overlay`) | 각 모니터마다 1개씩 생성되는 투명 전체 화면 창 (커서 + 키 표시)        |
| 스플래시                 | 초기 로딩 상태에서 표시                                                |

> 오버레이 창은 클릭을 통과시키며(`setIgnoreMouseEvents(true)`), 입력은 후킹을 통해 별도 전달됩니다.

## 설정 항목 매핑

컨트롤러 UI에서 조절되는 값들은 IPC 를 통해 메인 프로세스로 전달되고, 다시 모든 오버레이 창에 브로드캐스트됩니다.

| 상태 키                   | 의미                       | 기본값              |
| ------------------------- | -------------------------- | ------------------- |
| cursorFillColor           | 커서 내부 색상 (RGBA)      | rgba(0,100,255,0.5) |
| cursorStrokeColor         | 커서 테두리 색상           | rgba(32,38,50,0.5)  |
| cursorSize                | 커서 원 크기(px)           | 30                  |
| cursorStrokeSize          | 클릭 시 테두리 굵기(px)    | 3                   |
| showCursorHighlight       | 커서 하이라이트 표시 여부  | true                |
| keyDisplayMonitor         | 키 표시 대상 모니터 인덱스 | 0                   |
| keyDisplayDuration        | 키 유지 시간(ms)           | 2000                |
| keyDisplayFontSize        | 키 표시 폰트 크기(px)      | 16                  |
| keyDisplayBackgroundColor | 키 박스 배경색 (RGBA)      | rgba(0,0,0,0.5)     |
| keyDisplayTextColor       | 텍스트 색상                | #FFFFFF             |
| keyDisplayPosition        | 표시 위치                  | bottom-right        |
| showKeyDisplay            | 키 표시 활성 여부          | true                |

공통 설정 타입과 기본값은 `src/electron/contract.ts`, 저장소 생성은 `src/electron/settings.ts` 참조.

## 기술 스택

- **런타임 / 플랫폼**: Electron 40
- **프론트엔드**: React 19, Vite 7, TypeScript 5, Tailwind CSS 4
- **컴포넌트 / UI**: 필요한 Radix UI primitive와 커스텀 컴포넌트
- **상태 저장**: electron-store
- **입력 후킹**: uiohook-napi (Node-API / libuiohook)
- **품질 도구**: ESLint, Prettier (Tailwind 플러그인 + import sort), TypeScript strict

## 프로젝트 구조 (요약)

```

처음 코드를 읽는다면 아래 순서가 가장 단순합니다.

| 파일 | 역할 |
| --- | --- |
| `electron/main.ts` | 앱이 시작되는 순서와 종료 처리 |
| `electron/window.ts` | 컨트롤러 창과 모니터별 오버레이 창 |
| `electron/input.ts` | 커서·키보드·마우스 입력 시작/종료 |
| `electron/keyboard-input.ts` | 물리 키 이름과 조합키 문자열 변환 |
| `electron/contract.ts` / `settings.ts` | 공통 설정 타입·기본값과 저장 |
| `electron/ipc.ts` / `preload.cts` | Electron과 React 사이의 통신 |
mini-cast/
 ├─ public/             # 아이콘, 폰트, 정적 자원
 ├─ src/
 │   ├─ electron/       # 메인 프로세스 로직 (창, IPC, 입력 캡처 등)
 │   ├─ components/     # React 컴포넌트 (Controller, Overlay, 필요한 UI primitives)
 │   └─ lib/            # 공용 유틸
 ├─ tests/              # 입력 정규화 회귀 테스트
 ├─ package.json
 └─ vite.config.ts
```

## 실행 방법 (개발)

사전 요구: Node.js (LTS 권장), npm

```bash
# 1. 저장소 클론
git clone https://github.com/andongmin94/mini-cast.git
cd mini-cast

# 2. 의존성 설치
npm install

# 3. 개발 모드 (React + Electron 동시 실행)
npm run app
# - vite: 프론트엔드 dev 서버
# - tsc: electron TS 컴파일 (tsconfig.electron.json)
# - electron: 개발 모드로 실행
```

`npm run dev`는 Electron 개발 실행에 필요한 Vite 렌더러 서버만 시작합니다. 전체 기능 확인에는 `npm run app`을 사용하세요.

변경 검증은 `npm run typecheck`, `npm test`, `npm run lint`로 실행할 수 있습니다. 전체 포맷은 `npm run format`으로 별도 실행합니다.

## 빌드 / 패키징

Windows 휴대용(Portable) 실행 파일 생성

```bash
npm run build
# 결과물: output/ 에 실행 파일 (MiniCast.exe 등)
```

`electron-builder` 설정은 `package.json` 의 `build` 필드 참고.

> 현재 macOS 대상은 설정의 기본 스켈레톤만 존재 (`mac.target: dir`). DMG 패키징은 추후 작업 필요.

## 동작 흐름 개요

1. 앱 시작 → 싱글 인스턴스 잠금 확인
2. 스플래시 창 표시 (`createSplash`)
3. 저장 설정과 IPC를 먼저 초기화
4. 메인 창 + 다중 모니터 수 만큼 오버레이 창 생성
   - 개발 모드는 준비된 Vite 서버, 배포 모드는 패키지의 로컬 파일을 직접 로드
   - 전역 마우스/키보드 후킹 시작 (좌표 및 키 이벤트 브로드캐스트)
5. 디스플레이 추가/제거 시 오버레이 재생성 & 목록 갱신
6. Controller UI 조작 시 `miniCast.saveSettings()` → 모든 오버레이에 반영
7. 명시적 종료 시 트레이 제거, 입력 후킹과 폴링 정리

## 보안 / 권한 주의

- 전역 입력 후킹 사용 → 백신/OS 보안 경고가 나타날 수 있음
- `preload.cjs` 에서 `saveSettings()`, `onKeyPress()`처럼 이름이 정해진 기능만 `contextBridge` 로 노출
- 설정 파일은 로컬 사용자 디렉터리에 저장 (민감 정보 없음)

## 성능 고려 사항

- 마우스 위치는 1ms 주기로 확인하되, 움직임이 있을 때만 전송하고 정지 중에는 100ms keepalive만 전송
- 동일한 키 조합의 중복 훅 이벤트는 5ms 범위에서만 제거
- 다중 모니터 수 증가 시 오버레이 창 수 만큼 이벤트 브로드캐스트 발생 → 모니터 수가 매우 많을 경우 최적화 필요

## 향후 개선 아이디어

- 캔버스 드로잉/레이저 포인터 모드 추가
- 단축키 토글 (예: 표시/숨김 전환)
- 녹화 툴 연동 (OBS 플러그인 프로파일 가이드)
- 설정 UI 다국어(i18n)
- macOS 패키징(DMG) 및 코드서명
- 업데이트 자동 배포 (autoUpdater)
- 커서 애니메이션 / 클릭 파동 효과

## 문서 & 가이드

- 문서 사이트: [https://andongmin.com/mini-cast](https://andongmin.com/mini-cast)
- 문서 소스는 현재 이 저장소가 아니라 별도 docs 프로젝트에서 관리
- 현재 hero 의 다운로드 링크/버전 값은 릴리스 자동화 후 스크립트로 동기화 권장

## 기여 방법

추후 CONTRIBUTING.md 제공 예정. 우선 아래 프로세스 권장

1. Issue 생성 (버그/기능 제안)
2. Fork & 브랜치 생성 (feat/..., fix/...)
3. 커밋 컨벤션: 간결한 한글 또는 영어 (예: fix: overlay click pass-through)
4. PR 제출 후 코드 리뷰

## 스크린샷

(추후 추가) 예: 커서 하이라이트 / 키 입력 표시 / 다중 모니터 예시

## 문의

- Author: 안동민 (@andongmin94)
- GitHub Issues 활용
