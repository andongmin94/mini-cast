# 미니캐스트 (MiniCast)

키보드 & 마우스 입력을 실시간으로 화면에 시각화(오버레이)하여 강의, 라이브 스트리밍, 발표에 도움을 주는 데스크톱 애플리케이션입니다.

다중 모니터 환경을 지원하며, 커서 하이라이트와 키 입력 표시를 세밀하게 커스터마이즈할 수 있습니다.

> 현재 애플리케이션 버전: **v0.1.2**

---
## 핵심 기능
- 🔍 **마우스 커서 하이라이트**: 색상, 불투명도, 크기, 테두리 색/굵기 조절
- 🖱️ **마우스 클릭 반응**: 좌/중/우 클릭 시 테두리 강조
- ⌨️ **키보드 입력 표시**: 조합키(Ctrl / Shift / Alt / Meta) + 일반 키를 조합 형태로 표시 (단일 알파벳 연타 스팸 방지 필터 포함)
- 🖥️ **다중 모니터 지원**: 모든 모니터에 투명 오버레이 창 생성, 특정 모니터에만 키 입력 표시 가능
- 🎯 **표시 위치 선택**: 키 입력 표시 영역을 4개 코너 중 선택 (top-left / top-right / bottom-left / bottom-right)
- 🧩 **실시간 설정 반영**: 컨트롤러(UI)에서 바꾸는 즉시 오버레이에 적용 (IPC 실시간 통신)
- 💾 **설정 영구 저장**: `electron-store` 를 사용해 사용자 환경 유지
- 🧵 **글로벌 입력 후킹**: `node-global-key-listener` 로 전역 키/마우스 이벤트 수집
- 🪟 **투명 & 포커스 비활성 오버레이**: 실제 작업 방해 없이 위에 겹쳐 표시 (`BrowserWindow` + `setIgnoreMouseEvents`)
- 🚀 **Vite + React + Tailwind 기반 빠른 UI**
- 🧪 **싱글 인스턴스 보장**: 중복 실행 방지 (`app.requestSingleInstanceLock`)
- 🕒 **스플래시 화면 & 지연 초기화**: 자원 초기화 동안 사용자 경험 향상
- 🧰 **트레이 아이콘 지원 (Windows)**: (코드에 트레이 생성 존재) 빠른 접근성

---
## 화면 구성
| 구성 | 설명 |
|------|------|
| 컨트롤러 창 (`/`) | 설정 패널 (커서 / 키보드 탭) + 상단 커스텀 타이틀바 + 하단 광고 iframe |
| 오버레이 창 (`/overlay`) | 각 모니터마다 1개씩 생성되는 투명 전체 화면 창 (커서 + 키 표시) |
| 스플래시 | 초기 로딩 상태에서 표시 |

> 오버레이 창은 클릭을 통과시키며(`setIgnoreMouseEvents(true)`), 입력은 후킹을 통해 별도 전달됩니다.

---
## 설정 항목 매핑
컨트롤러 UI에서 조절되는 값들은 IPC 를 통해 메인 프로세스로 전달되고, 다시 모든 오버레이 창에 브로드캐스트됩니다.

| 상태 키 | 의미 | 기본값 |
|---------|------|--------|
| cursorFillColor | 커서 내부 색상 (RGBA) | rgba(0,100,255,0.5) |
| cursorStrokeColor | 커서 테두리 색상 | rgba(32,38,50,0.5) |
| cursorSize | 커서 원 크기(px) | 30 |
| cursorStrokeSize | 클릭 시 테두리 굵기(px) | 3 |
| showCursorHighlight | 커서 하이라이트 표시 여부 | true |
| keyDisplayMonitor | 키 표시 대상 모니터 인덱스 | 0 |
| keyDisplayDuration | 키 유지 시간(ms) | 2000 |
| keyDisplayFontSize | 키 표시 폰트 크기(px) | 16 |
| keyDisplayBackgroundColor | 키 박스 배경색 (RGBA) | rgba(0,0,0,0.5) |
| keyDisplayTextColor | 텍스트 색상 | #FFFFFF |
| keyDisplayPosition | 표시 위치 | bottom-right |
| showKeyDisplay | 키 표시 활성 여부 | true |

메인 프로세스 기준 기본 설정은 `src/electron/main.ts` 의 `currentSettings` 참조.

---
## 기술 스택
- **런타임 / 플랫폼**: Electron 37
- **프론트엔드**: React 19, Vite 7, TypeScript 5, Tailwind CSS 4
- **컴포넌트 / UI**: Radix UI, shadcn 유사 구성 (커스텀 wrapper들)
- **상태 저장**: electron-store
- **입력 후킹**: node-global-key-listener
- **차트/기타**: recharts, embla-carousel-react 등 (향후 확장 가능성)
- **품질 도구**: ESLint, Prettier (Tailwind 플러그인 + import sort), TypeScript strict

---
## 디렉터리 구조 (요약)
```
mini-cast/
 ├─ docs/              # VitePress 기반 문서 (사이트 hero 등)
 └─ packages/          # 실제 앱 (Electron + React)
     ├─ public/        # 아이콘, 폰트, 정적 자원
     ├─ src/
     │   ├─ electron/  # 메인 프로세스 로직 (창, IPC, 입력 캡처 등)
     │   ├─ components/# React 컴포넌트 (Controller, Overlay, UI primitives)
     │   ├─ hooks/     # 커스텀 훅
     │   └─ lib/       # 공용 유틸
     └─ package.json
```

---
## 실행 방법 (개발)
사전 요구: Node.js (LTS 권장), npm

```bash
# 1. 저장소 클론
git clone https://github.com/andongmin94/mini-cast.git
cd mini-cast/packages

# 2. 의존성 설치
npm install

# 3. 개발 모드 (React + Electron 동시 실행)
npm run app
# - vite: 프론트엔드 dev 서버
# - tsc: electron TS 컴파일 (tsconfig.electron.json)
# - electron: 개발 모드로 실행
```

오직 UI (웹)만 보고 싶다면:
```bash
npm run dev
```

---
## 빌드 / 패키징
Windows 휴대용(Portable) 실행 파일 생성:
```bash
npm run build
# 결과물: dist_app/ 에 실행 파일 (MiniCast.exe 등)
```
`electron-builder` 설정은 `packages/package.json` 의 `build` 필드 참고.

> 현재 macOS 대상은 설정의 기본 스켈레톤만 존재 (`mac.target: dir`). DMG 패키징은 추후 작업 필요.

---
## 동작 흐름 개요
1. 앱 시작 → 싱글 인스턴스 잠금 확인
2. 스플래시 창 표시 (`createSplash`)
3. Dev 모드면 개발 메뉴 구성, Prod면 메뉴 제거
4. 2초 지연 후: 
   - 사용 가능 포트 탐색 (`determinePort`) → React 앱 로드
   - 메인 창 + 다중 모니터 수 만큼 오버레이 창 생성
   - 전역 마우스/키보드 후킹 시작 (좌표 및 키 이벤트 브로드캐스트)
   - IPC 핸들러 등록 (설정 변경 등)
5. 디스플레이 추가/제거 시 오버레이 재생성 & 목록 갱신
6. Controller UI 조작 시 `update-settings` IPC → 모든 오버레이에 반영
7. 종료 시 트레이 제거, 글로벌 단축키 해제

---
## 보안 / 권한 주의
- 전역 입력 후킹 사용 → 백신/OS 보안 경고가 나타날 수 있음
- `preload.js` 에서 최소한의 IPC API 만 `contextBridge` 로 노출 (직접적인 Node API 차단)
- 설정 파일은 로컬 사용자 디렉터리에 저장 (민감 정보 없음)

---
## 성능 고려 사항
- 마우스 위치 폴링 주기: 8ms (`setInterval`) → 125Hz 근사. 필요 시 슬라이더화 또는 동적 조절 가능
- 키 입력 필터: 단일 알파벳 스팸 방지 로직 적용
- 다중 모니터 수 증가 시 오버레이 창 수 만큼 이벤트 브로드캐스트 발생 → 모니터 수가 매우 많을 경우 최적화 필요

---
## 향후 개선 아이디어
- 캔버스 드로잉/레이저 포인터 모드 추가
- 단축키 토글 (예: 표시/숨김 전환)
- 녹화 툴 연동 (OBS 플러그인 프로파일 가이드)
- 설정 UI 다국어(i18n)
- macOS 패키징(DMG) 및 코드서명
- 업데이트 자동 배포 (autoUpdater)
- 커서 애니메이션 / 클릭 파동 효과

---
## 문서 & 가이드
- 문서 사이트: `docs/` (VitePress) → `/guide/*` 에 개별 기능 가이드 확장 예정
- 현재 hero 의 다운로드 링크/버전 값은 릴리스 자동화 후 스크립트로 동기화 권장

---
## 기여 방법
추후 CONTRIBUTING.md 제공 예정. 우선 아래 프로세스 권장:
1. Issue 생성 (버그/기능 제안)
2. Fork & 브랜치 생성 (feat/..., fix/...)
3. 커밋 컨벤션: 간결한 한글 또는 영어 (예: fix: overlay click pass-through)
4. PR 제출 후 코드 리뷰

---
## 스크린샷
(추후 추가) 예: 커서 하이라이트 / 키 입력 표시 / 다중 모니터 예시

---
## 문의
- Author: 안동민 (@andongmin94)
- GitHub Issues 활용
