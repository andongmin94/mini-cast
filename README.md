<div align="center">
  <img src="https://andongmin.com/mini-cast/logo.svg" alt="MiniCast" height="160" />
</div>

# MiniCast

강의, 발표, 스트리밍 화면 위에 마우스·키보드 입력을 표시하고 직접 판서하는 Electron 앱입니다.

## 기능

- 커서 위치와 마우스 클릭 표시
- 조합키와 일반 키 표시
- 펜 · 형광펜 · 요소 지우개
- 모든 모니터에 걸친 시간순 실행 취소 · 다시 실행
- 현재 판서 모니터 전체 지우기
- 판서 모드에서 커서 하이라이트와 클릭 효과 자동 억제
- 다중 모니터 오버레이
- 작업 표시줄 영역을 포함한 전체 화면 판서
- 표시 색상, 크기, 위치, 지속 시간 설정
- 설정 저장, 트레이, 싱글 인스턴스

판서 문서와 실행 취소 이력은 Electron 메인 프로세스가 소유합니다. 디스플레이 이벤트로 오버레이 창이 다시 만들어져도 같은 디스플레이 ID의 판서는 유지되며, 앱을 종료하면 판서 문서는 초기화됩니다.

## 판서 단축키

| 조합 | 동작 |
| --- | --- |
| `Alt+Shift+1` | 클릭 통과 모드 |
| `Alt+Shift+3` | 펜 |
| `Alt+Shift+4` | 형광펜 |
| `Alt+Shift+5` | 지우개 |
| `Alt+Shift+6` | 실행 취소 |
| `Alt+Shift+7` | 현재 판서 모니터 지우기 |
| `Esc` | 진행 중 판서 취소 후 클릭 통과 |
| `Ctrl+Z` | 실행 취소 |
| `Ctrl+Shift+Z` | 다시 실행 |

실행 취소·다시 실행은 모든 모니터의 작업을 시간순으로 되돌립니다. 진행 중인 획이나 지우개 제스처가 있으면 첫 실행 취소는 그 제스처만 취소합니다. 컨트롤러 창을 닫아 숨길 때도 클릭 통과 모드로 자동 복귀하며, `Alt+Shift+1`은 전역 단축키 등록 충돌에 대비해 입력 훅에서도 비상 복귀를 처리합니다.

키 입력 표시는 판서 중에도 유지되며 MiniCast 자체 판서 단축키는 화면에 표시하지 않습니다.

## 기술 구성

- Electron 44
- React 19 + Vite 7 + TypeScript
- Tailwind CSS 4 + 필요한 Radix UI 컴포넌트
- HTML Canvas 2D 판서 렌더링
- `uiohook-napi` 전역 입력 후킹
- `electron-store` 설정 저장

완료된 판서와 진행 중 제스처를 서로 다른 Canvas에 렌더링합니다. 포인터 이동 중에는 현재 획만 증분 렌더링하고, 완료 문서는 변경될 때만 다시 그립니다.

## 구조

```text
src/
├─ annotation/
│  ├─ history.ts         모니터별 판서 문서와 전역 실행 취소/다시 실행
│  └─ geometry.ts        요소 지우개 점·이동 경로 히트 테스트
├─ electron/
│  ├─ main.ts            앱 시작, IPC, 판서 문서, 단축키
│  ├─ window.ts          컨트롤러와 모니터별 오버레이 창
│  ├─ input.ts           마우스·키보드 입력과 비상 클릭 통과
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
