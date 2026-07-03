<div align="center">
  <img src="https://andongmin.com/mini-cast/logo.svg" alt="MiniCast" height="160" />
</div>

# MiniCast

강의, 발표, 스트리밍 화면 위에 마우스 위치와 키보드 입력을 표시하는 Electron 앱입니다.

## 기능

- 커서 위치와 마우스 클릭 표시
- 조합키와 일반 키 표시
- 다중 모니터 오버레이
- 표시 색상, 크기, 위치, 지속 시간 설정
- 설정 저장, 트레이, 싱글 인스턴스

## 기술 구성

- Electron 40
- React 19 + Vite 7 + TypeScript
- Tailwind CSS 4 + 필요한 Radix UI 컴포넌트
- `uiohook-napi` 전역 입력 후킹
- `electron-store` 설정 저장

## 구조

```text
src/
├─ electron/
│  ├─ main.ts            앱 시작, IPC, 설정
│  ├─ window.ts          컨트롤러와 오버레이 창
│  ├─ input.ts           마우스·키보드 입력
│  ├─ keyboard-input.ts  키 이름 변환
│  ├─ display.ts         모니터 정렬
│  ├─ preload.cts        renderer API
│  ├─ tray.ts
│  └─ splash.ts
├─ components/
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
```

## 빌드

```bash
npm run build
```

Windows 결과물은 `output/`에 생성됩니다. 현재 배포 대상은 Windows x64이며 macOS 설정은 패키징 골격만 포함합니다.
