# 미니캐스트 시작하기

미니캐스트는 강의, 라이브 코딩, 화상회의, 스트리밍 녹화 중 키 입력과 마우스 포인터를 실시간으로 보여주는 Tauri 기반 데스크톱 앱입니다.

## 빠른 링크
- [마우스 설정](./mouse.md)
- [키보드 설정](./keyboard.md)
- [캔버스 설정(예정)](./canvas.md)

## 설치 및 실행
1. GitHub Releases에서 `MiniCast.exe`(무설치 실행 파일)를 내려받습니다.
2. 실행하면 메인 컨트롤러와 오버레이 창이 생성되고, 트레이 아이콘이 함께 올라옵니다.
3. 소스에서 직접 실행하려면 아래 명령을 사용합니다.

```bash
git clone https://github.com/andongmin94/mini-cast.git
cd mini-cast/packages
npm install
npm run tauri:dev
```

## 빌드
- `npm run tauri:build`: 빌드 전에 릴리즈 버전 동기화 스크립트를 실행한 뒤 번들 생성
- `npx tauri build`: 현재 로컬 버전 기준으로 바로 번들 생성

## 기본 사용 흐름
1. 컨트롤러에서 커서/키보드 옵션을 조정합니다.
2. 설정이 `nativeBridge`를 통해 Tauri 명령(`update_settings`)으로 전달됩니다.
3. Rust 백엔드가 오버레이 창들에 이벤트(`update-settings`, `mouse-move`, `key-press`)를 브로드캐스트합니다.
4. 각 오버레이는 자신의 display id와 설정값을 비교해 화면 표시 여부를 결정합니다.

## 현재 아키텍처 요약

| 영역 | 주요 파일 | 역할 |
|------|-----------|------|
| 프론트 메인 UI | `src/components/Controller.tsx` | 설정 변경 UI |
| 오버레이 렌더 | `src/components/Overlay.tsx` | 커서/키 표시 렌더 |
| 프론트 브리지 | `src/bridge/native.ts` | Tauri invoke/listen 래퍼 |
| 백엔드 | `src-tauri/src/lib.rs` | 모니터/입력 후킹/트레이/저장 처리 |
| 설정 저장 | `store.json` | 앱 데이터 디렉터리에 JSON 저장 |

## 다중 모니터 동작
- 실행 시 모니터 목록을 읽어 모니터별 오버레이 창을 생성합니다.
- 표시 이름은 `모니터 1`, `모니터 2` 형태로 정규화됩니다.
- 마우스 하이라이트는 활성 모니터 오버레이에만 표시됩니다.
- 키 이벤트는 모든 오버레이로 전달되지만, 각 오버레이에서 `keyDisplayMonitor` 기준으로 필터링됩니다.

## 자주 묻는 문제

| 증상 | 점검 |
|------|------|
| 키 표시가 안 나옴 | `키보드 활성화` ON 여부, `활성 모니터` 선택 확인 |
| 커서 하이라이트가 안 보임 | `커서 활성화` ON 여부, 색상/투명도 확인 |
| 일부 앱에서 키 입력 누락 | 관리자 권한 앱/보안 제품 영향 여부 확인 |
| 설정이 초기화됨 | 앱 데이터 디렉터리의 `store.json` 접근 가능 여부 확인 |
