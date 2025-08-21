---
title: 키보드 설정
outline: deep
---

# 키보드 설정

키 입력 표시 영역은 실시간 데모, 강좌 녹화, 스트리밍 시 시청자가 어떤 조합키/명령을 입력했는지 빠르게 이해하도록 돕습니다. 아래는 각 옵션과 내부 동작 구조를 설명합니다.

---
## 1. 설정 패널 항목

| UI 레이블 | 내부 키 | 설명 | 값 범위 / 형태 | 기본값 |
|-----------|---------|------|----------------|--------|
| 키보드 활성화 | showKeyDisplay | 키 표시 전체 ON/OFF | boolean | true |
| 활성 모니터 | keyDisplayMonitor | 키 표시를 담당할 오버레이 창 index | 0..N-1 | 0 |
| 지속 시간 | keyDisplayDuration | 키 입력이 표시 후 사라지기까지 시간(ms) | 500 ~ 5000 (100 step) | 2000 |
| 폰트 크기 | keyDisplayFontSize | 키 박스 텍스트 크기 | 10 ~ 60 | 16 |
| 배경 색상 | keyDisplayBackgroundColor | RGBA 변환 전 Hex + 투명 | Hex + Opacity | #000000 / 0.5 |
| 배경 투명 | keyDisplayBackgroundOpacity | 0이면 완전 불투명 계산 시 1 - opacity 로 처리 | 0 ~ 1 | 0.5 |
| 폰트 색상 | keyDisplayTextColor | 텍스트 표시 색상 | Hex | #FFFFFF |
| 표시 위치 | keyDisplayPosition | 4개 코너 중 위치 | top-left 등 | bottom-right |

색상 + 투명도는 컨트롤러에서 Hex + Opacity 로 관리되며 전송 시 RGBA 로 변환됩니다.

---
## 2. 표기 규칙
- 조합키: Ctrl + Shift + Alt + Meta 순서로 정렬 후 마지막에 실제 키
- 방향키: ↑ ↓ ← →
- 특수키 변환: ESCAPE → Esc, RETURN → Enter, BACK SPACE → Backspace 등 (`func.ts` 의 `keyNameMap` 참고)
- 마우스 키 (좌/중/우 클릭) 이벤트 문자열은 추후 키 표시와 통합 가능 (현재는 클릭 테두리 강조로 시각화)

---
## 3. 전역 후킹 & 필터
라이브러리: `node-global-key-listener`

처리 흐름:
1. DOWN 이벤트 수신 → 조합키 상태 맵(ctrl/shift/alt/meta) 업데이트
2. 특수키 여부 검사 (조합키 자체면 표시하지 않음)
3. 조합 문자열 구성 (예: Ctrl + Shift + K)
4. 마지막 전송 조합 & 타임스탬프 비교 → 200ms 이내 중복이면 무시 (중복 스팸 방지)
5. 단일 알파벳(key length = 1) && 조합키 없음 → (설정상 스팸 방지로) 무시
6. 나머지를 Overlay 로 브로드캐스트 → 해당 모니터 id 와 `keyDisplayMonitor` 가 일치할 때만 표시 큐에 push
7. `keyDisplayDuration` 경과 후 setTimeout 으로 제거

---
## 4. 다중 모니터 동작
모든 오버레이 창이 동일 메시지를 받지만, 표시 여부는 각 창이 가진 `displayId === keyDisplayMonitor` 조건으로 필터링합니다. 따라서 모니터 설정을 잘못 선택하면 아무것도 보이지 않을 수 있습니다.

---
## 5. 위치 지정
`keyDisplayPosition` 은 CSS 유틸 클래스로 변환되어 다음 코너 중 하나에 정렬됩니다:
- top-left, top-right, bottom-left, bottom-right

각 위치는 flex 컨테이너 정렬을 통해 좌/우 정렬까지 함께 처리합니다.

---
## 6. 성능 주의
- 매우 빠른 반복 입력(게임용 매크로 등) 상황에서는 필터로 인해 일부 키가 생략될 수 있습니다.
- `keyDisplayDuration` 값을 너무 길게(> 5초) 설정하면 다수의 키 박스가 누적되어 가독성이 떨어질 수 있습니다.

---
## 7. 문제 해결(FAQ)
| 증상 | 가능 원인 | 해결 |
|------|-----------|------|
| 아무 키도 안 나옴 | showKeyDisplay OFF | ON 으로 전환 |
| 다른 모니터에 표시됨 | keyDisplayMonitor 값 불일치 | 드롭다운에서 올바른 모니터 선택 |
| 조합키만 보임 | 단일 알파벳 필터 동작 | (향후 옵션화 예정) |
| 표시 사라지기 너무 빠름 | Duration 값 낮음 | 1000~2000ms 권장 |

---
## 8. 커스터마이징 아이디어 (향후)
- 알파벳 스팸 필터 On/Off 토글 추가
- 조합키 색상 하이라이트 (Ctrl=파랑, Shift=주황 등)
- JSON 기반 프리셋 저장/불러오기
- 폰트 패밀리 선택 / 모서리 라운드 값 조절

---
## 9. 관련 코드
- 입력 수집: `src/electron/func.ts` (`captureKeyboardEvents`)
- IPC 브로드캐스트: `src/electron/ipc.ts`
- 렌더 표시 로직: `src/components/Overlay.tsx`
- 설정 저장/로드: `electron-store` (`main.ts` / `Controller.tsx`)

---
## 10. 다음으로 보기
- [마우스 설정](./mouse.md)
- [캔버스 설정](./canvas.md)
- [시작하기](./index.md)