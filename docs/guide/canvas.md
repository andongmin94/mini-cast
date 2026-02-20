# 캔버스 설정 (예정)

> 이 문서는 향후 추가할 오버레이 드로잉 기능의 설계 초안입니다.

## 목표
- 발표/강의/리뷰 중 화면 위에 직접 그리기
- 현재 커서 하이라이트/키 표시와 충돌 없이 동작
- 다중 모니터 환경에서 일관된 좌표 처리

## 예정 기능
- 펜/하이라이터
- 직선/사각형/원
- 화살표/번호 마커
- 지우개, 실행 취소/다시 실행
- PNG 내보내기, 프리셋 저장

## Tauri 기준 아키텍처 초안

| 영역 | 방향 |
|------|------|
| 프론트 도구 상태 | React 상태 + 전용 store 모듈 |
| 렌더링 | Overlay Webview 내 Canvas(2D) |
| 명령/이벤트 | `nativeBridge` + Tauri 이벤트 채널 |
| 저장 | 앱 데이터 디렉터리 `store.json` 확장 |
| 다중 모니터 | 오버레이별 `displayId` 기준 분리 렌더 |

## 고려 사항
- 현재 1ms 입력 루프와 드로잉 이벤트가 동시에 동작할 때 CPU 사용량 관리
- 클릭 통과(`ignore cursor events`) 모드와 캔버스 입력 모드 전환 UX
- 오버레이 z-order 유지와 포커스 비간섭 보장

## 예상 파일 구조 (초안)
- `src/components/overlay/CanvasLayer.tsx`
- `src/components/overlay/useCanvasEvents.ts`
- `src/components/settings/canvas.ts`
- `src-tauri/src/lib.rs` (캔버스 관련 이벤트/저장 명령 확장)

