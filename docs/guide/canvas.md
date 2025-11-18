# 캔버스 설정 (예정)

> 이 문서는 앞으로 추가될 **드로잉 / 레이저 포인터 / 강조(Annotation)** 기능의 사전 기획 초안입니다. 실제 UI 및 API 는 구현 과정에서 일부 변경될 수 있습니다.

## 목표
프리젠테이션, 강의, 라이브 코드 리뷰 중 **화면 위에 실시간으로 그리거나 강조**할 수 있는 레이어 제공. OBS/Zoom 공유 화면 위에서도 자연스럽게 표시.

## 예상 기능 목록
| 기능 | 설명 | 세부 옵션 (초안) |
|------|------|------------------|
| 펜 (Pen) | 자유 곡선 드로잉 | 색상, 두께, 불투명도, 부드럽기(smoothing) |
| 형광펜 (Highlighter) | 반투명 굵은 스트로크 | 색상, 두께, 혼합모드(multiply) |
| 레이저 포인터 | 임시 점 + 잔상(Trail) | 색상, 잔상 길이, 페이드 속도 |
| 도형 | 직선, 사각형, 타원 | 테두리/채움 색상, 투명도, Shift 비율 잠금 |
| 화살표 | 방향 강조 | 두께, 머리 크기, 채움 여부 |
| 번호 마커 | 클릭 순서 번호 찍기 | 색상, 크기, 자동증가/리셋 |
| 스포트라이트 | 화면 어둡게 + 원형/사각형 영역만 강조 | 반경, 테두리 흐림, 투명도 |
| 지우개 | 드로잉 요소 제거 | 전체/영역/최근 1개 |
| 되돌리기/재실행 | 드로잉 스택 관리 | 최대 히스토리 깊이 |
| 프리셋 | 도구 + 스타일 묶음 저장 | 이름, 단축키 지정 |

## 기술 설계 초안
| 항목 | 선택지 | 메모 |
|------|--------|------|
| 렌더링 | HTML Canvas 2D | 초기 단순 구현; 성능 이슈 시 WebGL 고려 |
| 구조 | 도형 엔티티 리스트 + 렌더 루프 | 변환/히트 테스트 용이 |
| 좌표 | 디스플레이 개별 overlay 창 기준 | 멀티 모니터 분리 관리 |
| 저장 | 세션 임시 메모리 (필요 시 export) | PNG 투명배경 / JSON 벡터 |
| IPC | Controller ↔ Main ↔ Overlay | 도구/스타일 변경 브로드캐스트 |
| 단축키 | 글로벌/포커스 구분 | 충돌 방지 (Ctrl+Z 등) |

## 예상 상태 모델 (초안 TypeScript 인터페이스)
```ts
interface CanvasToolState {
	activeTool: 'pen' | 'highlighter' | 'arrow' | 'shape' | 'marker' | 'spotlight' | 'eraser';
	color: string;            // RGBA 또는 Hex
	thickness: number;        // px
	opacity: number;          // 0~1
	smoothing: number;        // 0~1 (펜 곡선 보정)
	highlightBlend: boolean;  // 혼합 모드 여부
	spotlight?: { radius: number; dimOpacity: number; shape: 'circle' | 'rect' };
	marker?: { autoIncrement: boolean; nextIndex: number };
}

interface CanvasShape {
	id: string;
	type: 'stroke' | 'rect' | 'ellipse' | 'arrow' | 'marker';
	points: { x: number; y: number; }[]; // stroke/polyline
	style: { color: string; thickness: number; opacity: number; fill?: string };
	meta?: any;
}
```

## 성능 고려
- 펜 스트로크: 포인트 단위 → 일정 거리/각도 이하 포인트 단순화 (Ramer–Douglas–Peucker)
- 레이저 포인터: 잔상은 큐 구조 + 매 프레임 알파 감소 후 제거
- Undo/Redo: 명령 스택 (Command Pattern) 또는 immutable snapshot (메모리 비용 고려)
- 멀티 모니터: 각 Overlay 개별 캔버스 → 동시 드로잉 필요 시 브로드캐스트

## 보안/제한
- 글로벌 마우스 후킹 이미 존재 → 도구 활성 시 커서 하이라이트와 충돌 가능성 → 모드 전환 UX 필요
- OS 가속/하드웨어 합성에 따라 투명창 캔버스 성능 차이 발생 가능

## UI 초안(컨트롤러 탭 추가)
```
┌ Canvas 설정 ────────────────────────┐
│ [펜] [형광펜] [화살표] [도형] [레이저] [스포트라이트] [번호] [지우개] │
│ 색상 ●  굵기 ▢▢▢  불투명도 [====]  스무딩 [==]  프리셋 ▼              │
│ 도구별 추가 옵션 패널 (예: 스포트라이트 반경 슬라이더 등)         │
└──────────────────────────────────────┘
```

## 로드맵 제안 단계
| 단계 | 범위 | 산출물 |
|------|------|--------|
| 1 | Pen + Highlighter + Undo | MVP 드로잉 기능 |
| 2 | Arrow + Shapes + Export | 기본 주석 완성 |
| 3 | Spotlight + Marker | 발표/강의 집중 기능 |
| 4 | Preset + Shortcuts | 생산성 개선 |
| 5 | 레코딩 연동 / OBS Scene Guide | 배포/홍보 강화 |

## 피드백 요청
필요/우선순위가 높은 도구 또는 워크플로를 Issue 로 제안해주세요. 실제 사용 사례(예: CS 강의, UI 리뷰, 라이브 디버깅) 공유 환영.

## 관련 파일 예정
| 파일 (예정) | 역할 |
|-------------|------|
| `canvas-state.ts` | 도구/도형 상태 관리 (store) |
| `canvas-renderer.tsx` | 캔버스 React 컴포넌트 |
| `canvas-ipc.ts` | IPC 채널 (도구 변경/드로잉 동기화) |
| `canvas-utils.ts` | 좌표 변환, 단순화 알고리즘 |

## 다음으로 보기
- [마우스 설정](./mouse.md)
- [키보드 설정](./keyboard.md)
- [시작하기](./index.md)
