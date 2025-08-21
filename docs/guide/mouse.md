---
title: 마우스 설정
outline: deep
---

# 마우스 설정

마우스 커서 하이라이트와 클릭 반응은 시청자에게 현재 포커스 지점과 동작을 명확히 전달합니다. 본 문서는 각 속성과 내부 동작 구조, 최적화 팁을 제공합니다.

---
## 1. 표시 요소 개요
| 요소 | 설명 |
|------|------|
| 원형 하이라이트 | 커서 위치를 중심으로 표시되는 원 (채움 + 클릭 시 테두리) |
| 클릭 테두리 강조 | 좌/중/우 클릭 시 stroke 적용 (굵기, 색상, 투명도 반영) |
| 투명 오버레이 | 실제 커서는 OS 기본 커서, 하이라이트는 Overlay 창에서 별도 렌더 |

---
## 2. 설정 항목

| UI 레이블 | 내부 키 | 설명 | 범위 / 형태 | 기본값 |
|-----------|---------|------|-------------|--------|
| 커서 활성화 | showCursorHighlight | 하이라이트 전체 토글 | boolean | true |
| 칠 색상 | cursorFillColor | Hex → RGBA 변환 후 내부 저장 | Hex | #0064FF |
| 칠 투명 | cursorFillOpacity | 0~1 (실제 RGBA 알파는 1 - opacity 로 계산) | 0~1 | 0.5 |
| 획 색상 | cursorStrokeColor | 클릭 시 나타나는 stroke 색상 | Hex | #202632 |
| 획 투명 | cursorStrokeOpacity | stroke alpha 제어 | 0~1 | 0.5 |
| 칠 크기 | cursorSize | 원 지름(px) | 10~60 | 30 |
| 획 크기 | cursorStrokeSize | 클릭 시 stroke 두께(px) | 0~30 | 3 |

색상 + 투명도 조합은 Controller 에서 RGBA 로 합성되어 메인 프로세스 저장 → Overlay 수신.

---
## 3. 렌더링 흐름
1. 메인 프로세스에서 8ms 간격으로 `screen.getCursorScreenPoint()` → 활성 디스플레이 판정
2. 활성 디스플레이 오버레이에게만 좌표 전송 (`mouse-move`)
3. Overlay 컴포넌트는 state 로 `mousePosition` 업데이트
4. `showCursorHighlight` 가 true 이고 좌표 유효 → 절대 위치에 원 SVG/Div 스타일 렌더
5. 클릭 이벤트(`MOUSE LEFT DOWN/UP` 등) 수신 시 stroke 유무/굵기 토글

---
## 4. 클릭 시각화
`func.ts` 의 `captureKeyboardEvents` 내에서 마우스 버튼 DOWN/UP 문자열을 오버레이로 전송합니다. Overlay 에서는 각각의 상태를 별도 boolean (leftClick/middleClick/rightClick) 으로 추적하여 stroke 활성화 여부 결정.

---
## 5. 색상 & 투명도 변환
컨트롤러는 사용자가 선택한 Hex + Opacity 를 RGBA 로 변환할 때 `1 - opacity` 로 알파를 역산(UX 상 슬라이더를 '투명도' 로 표현). 예: Opacity 슬라이더 0.5 → RGBA a = 0.5.

---
## 6. 성능 고려
- 폴링 주기 8ms (≈125Hz) 는 대부분의 상황에서 충분히 부드럽습니다.
- 고주사율(165Hz+) 환경에서 완벽한 추종이 필요하면 주기 옵션화를 고려 (향후 로드맵)
- CPU 사용 모니터링: 다중 4K 모니터 + 큰 cursorSize + 잦은 클릭 이벤트 시 약간 증가 가능

---
## 7. 추천 설정 시나리오
| 상황 | 제안 값 |
|------|---------|
| 일반 강의 | 크기 30 / 칠 투명 0.5 / 획 굵기 3 |
| 작은 화면 녹화 | 크기 24 / 칠 투명 0.3 / 획 굵기 2 |
| 어두운 테마 | 밝은 청록/노랑 계열 칠 + 진한 회색 stroke |
| 밝은 테마 | 진한 블루/퍼플 칠 + 어두운 stroke (투명도 0.4) |

---
## 8. 문제 해결
| 증상 | 원인 후보 | 해결 |
|------|----------|------|
| 원이 안 보임 | showCursorHighlight OFF | ON 으로 전환 |
| 클릭 강조 없음 | 획 크기 0 | 1 이상으로 조정 |
| 너무 흐릿함 | 투명도 너무 높음 | Opacity 값 낮게 조정 |
| 버벅거림 | 매우 낮은 성능 PC | 폴링 주기 증가(코드 수정) / 크기 축소 |

---
## 9. 코드 참조
- 커서 추적: `src/electron/func.ts` → `captureMouseEvents`
- 오버레이 렌더: `src/components/Overlay.tsx`
- 설정 전송: `Controller.tsx` → `electron.send('update-settings')`

---
## 10. 향후 기능(계획)
| 범주 | 내용 |
|------|------|
| 애니메이션 | 클릭 파동(ripple) / 페이드 인·아웃 |
| 모양 | 원 외에 사각형 / 링 / 스포트라이트 모드 |
| 다중 커서 | 협업 세션 다중 포인터 표시 |
| 주기 설정 | 폴링 주기 슬라이더화 |

---
## 11. 다음으로 보기
- [키보드 설정](./keyboard.md)
- [캔버스 설정](./canvas.md)
- [시작하기](./index.md)