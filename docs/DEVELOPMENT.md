# 개발 가이드

## 디렉터리의 책임

```text
src/
  annotation/          판서 문서·이력·기하·변경분 동기화·Canvas 렌더링
  electron/            main·preload·창·트레이·입력·파일 저장
    testing/           Electron에서 실행하는 통합 검증과 Windows 입력 도우미
  renderer/            React 진입점·화면·UI·스타일
  shared/              양쪽에서 사용하는 계약·색상·설정 정규화
tests/
  unit/annotation/     판서 코어 회귀 검사
  unit/electron/       데스크톱 상태·생명주기·보안 설정 검사
  unit/shared/         공용 설정과 색상 검사
scripts/               Windows 검증·진단·배포 ZIP 작성
docs/                  개발 가이드와 변경 이력
```

`@/`는 `src/`를 가리킵니다. renderer는 `electron/` 구현을 직접 가져오지 않습니다. 공용 타입과 순수 변환은 `shared/`에서 가져오며 실제 OS 기능은 preload API를 통해 요청합니다.

`electron/testing/`은 현재 앱의 `--smoke-test`와 `--interaction-smoke-test`를 구현합니다. 이 모듈들은 검증용으로 분리되어 있지만 현재 패키지에 포함되므로, 패키지에서 테스트 코드까지 제외했다고 해석하면 안 됩니다.

## 작업 방식

- 브랜치는 `main`만 유지합니다. 요청 없이 새 브랜치·PR·임시 감사 디렉터리를 만들지 않습니다.
- 수정은 작게 묶고 `npm run check` 후 커밋합니다. 기존 경로를 재노출하는 호환 래퍼는 두지 않습니다.
- 일반 push와 문서 수정은 Actions를 실행하지 않습니다. Windows 검증은 Actions → Verify → Run workflow로 필요할 때만 실행합니다.
- 테스트 실패를 성공으로 바꾸거나 보안 감사를 생략하지 않습니다. 수동 실행이 실패하면 결과는 실패입니다.

## 실행 및 검증

```bash
npm ci
npm run app
npm run check
npm run smoke
npm run build
```

Windows 전체 검증은 타입 검사, 단위 테스트, 린트, 의존성 감사, 소스 실입력 검사, MSI/포터블 작성과 설치·제거 검사를 수행합니다. CI의 Windows 환경에서 `scripts/verify-source.ps1`, `scripts/verify-windows.ps1`, `scripts/verify-diagnostics.ps1`, `scripts/package-bundle.ps1`을 실행합니다.

빌드 결과는 `dist/`와 `output/`, 진단 결과는 `verification-logs/`에 생성합니다. 모두 Git 추적 대상이 아닙니다. 패키징 전 Vite가 `dist/`를 비우므로 반드시 renderer 빌드 뒤 Electron을 다시 빌드해야 합니다.

## 판서 데이터와 렌더링

main process가 문서와 전역 Undo/Redo를 소유합니다. 일반 편집은 revision과 추가·삭제 획만 전송하고, 첫 연결·재설정·누락 복구는 전체 snapshot을 사용합니다. 완료 획은 불변 객체로 공유하며, renderer의 단일 replica가 이벤트와 invoke 응답의 순서 차이를 처리합니다.

새 획은 append 렌더링하고, 삭제·Undo는 영향받은 영역을 재합성합니다. 반투명 획을 직접 clipping하면 래스터 결과가 달라질 수 있어, 같은 크기의 재사용 Canvas에서 합성 후 정수 픽셀 영역만 복사합니다. 화면 크기나 DPR 변경에는 전체 재그리기가 필요합니다.

작은 변경의 전송량은 줄였지만, 획 목록 비교·최초 로딩·큰 변경은 문서 크기에 영향을 받습니다. 부분 재합성용 Canvas도 메모리를 사용합니다. CI의 가상 DPR·소프트웨어 합성 검사는 실제 GPU·펜·혼합 DPI 장비 검증과 다릅니다.

## 알림

저장소는 자동 검증을 실행하지 않습니다. GitHub 자체의 Actions 이메일은 계정 설정이며, 완전히 끄려면 Settings → Notifications → System → Actions에서 Email을 끄거나 Don't notify를 선택합니다. 수동 검증 실패 여부와 이메일 설정은 별개입니다.


## 고정 소스 배포 검증

`package-bundle.ps1`은 깨끗한 Git HEAD와 tree를 기록하며, `MINICAST_SOURCE_SHA`가 지정되면 실제 HEAD와 같아야 합니다. MSI·포터블 EXE·BUILD-METADATA.json·SHA256SUMS.txt를 같은 ZIP에 포함합니다. 내부 해시는 설치 파일과 메타데이터 모두를 포함하며 ZIP 자체의 해시는 바깥 BUNDLE-SHA256.txt에 기록합니다. 메타데이터의 `commit`은 제품 소스이고 `workflow_commit`은 실행을 시작한 워크플로 커밋입니다. 두 값은 같다고 가정하지 않습니다.
