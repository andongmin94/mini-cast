<div align="center">

<a href="https://bio.andongmin.com/mini-cast">
<img src="https://bio.andongmin.com/mini-cast/logo.svg" alt="logo" height="200" />
</a>

</div>

# MiniCast

강의, 발표, 스트리밍 화면 위에 마우스·키보드 입력을 표시하고 직접 판서하는 Electron 앱입니다.

## 기능

- 커서 위치와 마우스 클릭 표시
- 조합키와 일반 키 표시
- 펜 · 형광펜 · 요소 지우개
- 직선 · 화살표 · 사각형 · 타원 · 한글/여러 줄 텍스트
- 객체 선택 · Shift 추가 선택 · 그룹 이동 · 선택 삭제
- 모든 모니터에 걸친 시간순 실행 취소 · 다시 실행
- 마지막 판서 모니터 또는 현재 커서 모니터 전체 지우기
- 판서 모드에서 커서 하이라이트와 클릭 효과 자동 억제
- 다중 모니터 오버레이
- 작업 표시줄 영역을 포함한 전체 화면 판서
- 표시 색상, 크기, 위치, 지속 시간 설정
- 설정 저장, 트레이, 싱글 인스턴스
- 장시간 세션의 판서 포인트·실행 취소 이력 상한
- 분리된 모니터의 세션 문서와 관련 Undo·Redo 상태 정리

판서 문서와 실행 취소 이력은 Electron 메인 프로세스가 소유합니다. 디스플레이 이벤트로 오버레이 창이 다시 만들어져도 같은 디스플레이 ID의 판서는 유지되며, 앱을 종료하면 판서 문서는 초기화됩니다.

## 판서 단축키

| 조합 | 동작 |
| --- | --- |
| `Alt+Shift+1` | 클릭 통과 모드 |
| `Alt+Shift+3` | 펜 |
| `Alt+Shift+4` | 형광펜 |
| `Alt+Shift+5` | 지우개 |
| `Alt+Shift+6` | 실행 취소 |
| `Alt+Shift+7` | 현재 커서 모니터 지우기 |
| `Esc` | 진행 중 판서 취소 후 클릭 통과 |
| `Ctrl+Z` | 실행 취소 |
| `Ctrl+Shift+Z` | 다시 실행 |

실행 취소·다시 실행은 모든 모니터의 작업을 시간순으로 되돌립니다. 진행 중인 획이나 지우개 제스처가 있으면 첫 실행 취소는 그 제스처만 취소합니다. 컨트롤러의 `화면지우기`는 마지막으로 판서한 모니터를 대상으로 하며, `Alt+Shift+7`은 현재 커서가 있는 모니터를 지웁니다. 컨트롤러 창을 닫아 숨길 때도 클릭 통과 모드로 자동 복귀하며, `Alt+Shift+1`은 전역 단축키 등록 충돌에 대비해 입력 훅에서도 비상 복귀를 처리합니다.

키 입력 표시는 판서 중에도 유지되며 MiniCast 자체 판서 단축키는 화면에 표시하지 않습니다.

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

## 개발 문서

[구조·개발·검증 가이드](docs/DEVELOPMENT.md) · [개발 변경 이력](docs/CHANGELOG.md)

작업 브랜치는 `main` 하나만 사용합니다. Actions 검증은 자동 실행하지 않으며, 필요한 시점에 `Verify`를 직접 실행합니다.

도형의 Shift 보정과 텍스트 배치 방법은 [도형·텍스트 가이드](docs/ANNOTATION-TOOLS.md)를 참고합니다.
