# 키보드 설정

키 입력 표시는 단축키 시연, 실시간 데모, 강의 녹화에서 현재 입력을 빠르게 전달하기 위한 기능입니다.

## 설정 항목

| UI 레이블 | 내부 키 | 설명 | 기본값 |
|-----------|---------|------|--------|
| 키보드 활성화 | `showKeyDisplay` | 키 표시 전체 ON/OFF | `true` |
| 활성 모니터 | `keyDisplayMonitor` | 키 표시 대상 모니터 인덱스 | `0` |
| 지속 시간 | `keyDisplayDuration` | 표시 유지 시간(ms) | `2000` |
| 폰트 크기 | `keyDisplayFontSize` | 키 텍스트 크기(px) | `16` |
| 배경 색상 | `keyDisplayBackgroundColor` | 키 박스 배경 색 | `#000000` |
| 배경 투명 | `keyDisplayBackgroundOpacity` | 배경 투명도(0~1) | `0.5` |
| 폰트 색상 | `keyDisplayTextColor` | 텍스트 색상 | `#FFFFFF` |
| 표시 위치 | `keyDisplayPosition` | `top/bottom + left/right` | `bottom-right` |

## 입력 처리 구조 (Tauri)
1. Rust 백엔드(`src-tauri/src/lib.rs`)에서 `rdev::listen`으로 전역 입력을 수신합니다.
2. 키/조합키를 정규화해 조합 문자열(예: `Ctrl + Shift + K`)을 구성합니다.
3. 중복 조합은 `COMBINATION_DEDUP_MS`(현재 5ms) 기준으로 필터링합니다.
4. 이벤트를 각 오버레이 창으로 `key-press` 이벤트 전송합니다.
5. 오버레이(`src/components/overlay/useOverlayEvents.ts`)는 `keyDisplayMonitor`와 `displayId`를 비교해 표시 여부를 결정합니다.
6. 표시된 항목은 `keyDisplayDuration` 후 자동 제거됩니다.

## Windows 보완 경로
- 일부 환경에서 전역 키 이벤트가 빠질 수 있어 `GetAsyncKeyState` 기반 fallback 폴링 워커를 함께 사용합니다.
- fallback 폴링 주기: 1ms
- rdev 이벤트가 최근(120ms 이내) 들어오면 fallback emit을 억제해 중복을 줄입니다.

## 다중 모니터 동작
- 키 이벤트는 모든 오버레이로 전달되지만, 실표시는 선택된 모니터 인덱스에서만 발생합니다.
- 모니터 레이블은 컨트롤러에서 `모니터 1`, `모니터 2`처럼 표시됩니다.

## 관련 코드
- 입력 수집/필터/브로드캐스트: `src-tauri/src/lib.rs`
- 브리지: `src/bridge/native.ts`
- 오버레이 이벤트 처리: `src/components/overlay/useOverlayEvents.ts`
- 컨트롤러 설정 반영: `src/components/controller/useControllerSettings.ts`

