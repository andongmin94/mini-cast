<div align="center">
  <img src="https://andongmin.com/mini-cast/logo.svg" alt="MiniCast" height="160" />
</div>

# MiniCast

강의, 발표, 스트리밍 화면 위에 마우스·키보드 입력을 표시하고 직접 판서하는 Electron 앱입니다.

## 기능

- 커서 위치와 마우스 클릭 표시
- 조합키와 일반 키 표시
- 펜 · 형광펜 · 요소 지우개
- 실행 취소 · 다시 실행 · 현재 화면 전체 지우기
- 판서 모드에서 커서 하이라이트와 클릭 효과 자동 억제
- 다중 모니터 오버레이
- 표시 색상, 크기, 위치, 지속 시간 설정
- 설정 저장, 트레이, 싱글 인스턴스

## 판서 단축키

| 조합 | 동작 |
| --- | --- |
| `Alt+Shift+1` | 클릭 통과 모드 |
| `Alt+Shift+3` | 펜 |
| `Alt+Shift+4` | 형광펜 |
| `Alt+Shift+5` | 지우개 |
| `Alt+Shift+6` | 실행 취소 |
| `Alt+Shift+7` | 현재 판서 화면 지우기 |
| `Esc` | 판서 종료 후 클릭 통과 |
| `Ctrl+Z` | 실행 취소 |
| `Ctrl+Shift+Z` | 다시 실행 |

실행 취소·화면 지우기와 `Esc`는 판서 모드에서만 전역으로 잡습니다. 키 입력 표시는 판서 중에도 유지되며 MiniCast 자체 판서 단축키는 화면에 표시하지 않습니다.

## 기술 구성

- Electron 40
- React 19 + Vite 7 + TypeScript
- HTML Canvas 2D 판서 렌더링
- Tailwind CSS 4 + 필요한 Radix UI 컴포넌트
- `uiohook-napi` 전역 입력 후킹
- `electron-store` 설정 저장

## 구조

```text
src/
├─ annotation/
│  ├─ history.ts         판서 문서와 실행 취소/다시 실행
│  └─ geometry.ts        요소 지우개 히트 테스트
├─ electron/
│  ├─ main.ts            앱 시작, IPC, 설정, 판서 모드·단축키
│  ├─ window.ts          컨트롤러와 모니터별 오버레이 창
│  ├─ input.ts           마우스·키보드 입력
│  ├─ keyboard-input.ts  키 이름 변환
│  ├─ display.ts         모니터 정렬
│  ├─ preload.cts        renderer API
│  ├─ tray.ts
│  └─ splash.ts
├─ components/
│  ├─ AnnotationControls.tsx
│  ├─ AnnotationSurface.tsx
│  ├─ Controller.tsx
│  ├─ Overlay.tsx
│  └─ TitleBar.tsx
├─ App.tsx
└─ main.tsx
```

## 실행

Node.js 22.12 이상이 필요합니다. Node.js 24 사용을 권장합니다.

```bash
npm ci
npm run app
```

`npm run dev`는 renderer만 실행합니다. 전역 입력과 오버레이를 확인하려면 `npm run app`을 사용합니다.

## 검증

```bash
npm run typecheck
npm test
npm run lint
npm run smoke
```

## 빌드

```bash
npm run build
```

Windows 결과물은 `output/`에 생성됩니다. 현재 배포 대상은 Windows x64이며 macOS 설정은 패키징 골격만 포함합니다.
