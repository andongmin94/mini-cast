from pathlib import Path
import os, re, json, subprocess, textwrap
root = Path.cwd()
files = subprocess.check_output(['git','ls-files'], text=True).splitlines()
moves = {}
for p in files:
    if p.startswith(('src/components/','src/lib/')) or p in ['src/App.tsx','src/main.tsx','src/globals.css','src/vite-env.d.ts']:
        moves[p] = 'src/renderer/' + p.removeprefix('src/')
    elif p in ['src/electron/contract.ts','src/electron/color.ts','src/electron/settings.ts']:
        moves[p] = 'src/shared/' + Path(p).name
    elif p == 'src/electron-api.d.ts':
        moves[p] = 'src/shared/electron-api.d.ts'
    elif p in ['src/electron/smoke.ts','src/electron/interaction-smoke.ts','src/electron/rendering-smoke.ts']:
        moves[p] = 'src/electron/testing/' + Path(p).name
    elif p.startswith('tests/') and p.endswith('.test.mjs'):
        name = Path(p).name
        category = 'annotation' if name.startswith('annotation-') and name != 'annotation-target.test.mjs' or name in ['eraser-index.test.mjs','gesture-leases.test.mjs'] else 'shared' if name in ['color.test.mjs','settings.test.mjs'] else 'electron'
        moves[p] = f'tests/unit/{category}/{name}'
contents = {p: Path(p).read_text(encoding='utf-8') for p in files if Path(p).suffix in ['.ts','.tsx','.cts','.mjs','.js','.json','.html','.css','.md']}
alias_map = {}
for p in files:
    if p.startswith('src/'):
        stem = str(Path(p).with_suffix('')).replace(os.sep, '/')
        dest = moves.get(p,p)
        alias_map[p] = dest
        alias_map[stem] = str(Path(dest).with_suffix('')).replace(os.sep, '/')
        if Path(p).suffix in ['.ts','.tsx','.cts'] and not p.endswith('.d.ts'):
            extension = '.cjs' if p.endswith('.cts') else '.js'
            alias_map[stem+extension] = str(Path(dest).with_suffix(extension)).replace(os.sep, '/')
            alias_map['dist/'+str(Path(p.removeprefix('src/')).with_suffix(extension)).replace(os.sep, '/')] = 'dist/'+str(Path(dest.removeprefix('src/')).with_suffix(extension)).replace(os.sep, '/')
    else:
        alias_map[p] = moves.get(p,p)
for p,s in contents.items():
    newp = moves.get(p,p)
    def replace(m):
        spec = m.group(2)
        if spec.startswith('@/'):
            target = 'src/'+spec[2:]
            updated = alias_map.get(target)
            if updated:
                return m.group(1)+'@/'+updated.removeprefix('src/')+m.group(3)
        elif spec.startswith(('./','../')):
            target = os.path.normpath(str(Path(p).parent/spec)).replace(os.sep, '/')
            updated = alias_map.get(target)
            if updated:
                rel = os.path.relpath(updated,Path(newp).parent).replace(os.sep,'/')
                if not rel.startswith('.'):
                    rel = './'+rel
                return m.group(1)+rel+m.group(3)
        return m.group(0)
    s = re.sub(r'([\'"`])([^\'"`\n]+)([\'"`])', replace, s)
    if p == 'src/electron/rendering-smoke.ts':
        s = s.replace('`../annotation/${name}.js`','`../../annotation/${name}.js`')
    if p == 'index.html':
        s = s.replace('src="/src/main.tsx"','src="/src/renderer/main.tsx"')
    if p == 'eslint.config.js':
        s = s.replace('"src/App.tsx"','"src/renderer/App.tsx"').replace('"src/main.tsx"','"src/renderer/main.tsx"').replace('"src/components/**/*.{ts,tsx}"','"src/renderer/components/**/*.{ts,tsx}"')
    if p == 'tsconfig.electron.json':
        s = s.replace('"src/annotation/**/*.ts",','"src/annotation/**/*.ts",\n    "src/shared/**/*.ts",')
    if p == 'package.json':
        data = json.loads(s)
        data['scripts']['test'] = 'npm run build:electron && node --test "tests/unit/**/*.test.mjs"'
        data['scripts']['check'] = 'npm run typecheck && npm test && npm run lint'
        s = json.dumps(data,ensure_ascii=False,indent=2)+'\n'
    if p == 'src/vite-env.d.ts':
        s = '/// <reference types="vite/client" />\n'
    if p == 'tests/security-config.test.mjs':
        s = s.replace('assert.match(workflow, /pull_request:/);', 'assert.match(workflow, /workflow_dispatch:/);\n  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);')
    dest = Path(newp)
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(s, encoding='utf-8', newline='\n')
for old,new in moves.items():
    Path(old).unlink()
workflow = Path('.github/workflows/verify.yml').read_text(encoding='utf-8')
byname = {}
for block in workflow.split('      - name: ')[1:]:
    name = block.splitlines()[0]
    if '        run: |\n' in block:
        byname[name] = {'run': textwrap.dedent(block.split('        run: |\n',1)[1]).rstrip()+'\n'}
script_names = {'패키징 전 실제 입력·Canvas 참조 비교':'verify-source.ps1','판서 변경분 전송·부분 렌더링 진단':'verify-diagnostics.ps1'}
for name,filename in script_names.items():
    prefix = "$ErrorActionPreference = 'Stop'\nSet-StrictMode -Version Latest\nSet-Location (Split-Path -Parent $PSScriptRoot)\n\n"
    Path('scripts/'+filename).write_text(prefix+byname[name]['run'], encoding='utf-8', newline='\n')
bundle = "$ErrorActionPreference = 'Stop'\nSet-StrictMode -Version Latest\nSet-Location (Split-Path -Parent $PSScriptRoot)\n\n"
bundle += byname['산출물 SHA-256 생성']['run']+'\n'+byname['최종 ZIP 무결성 및 내부 해시 대조']['run']
Path('scripts/package-bundle.ps1').write_text(bundle, encoding='utf-8', newline='\n')
readme = Path('README.md').read_text(encoding='utf-8')
intro = readme.split('## 기술 구성')[0]
if intro.startswith('<div align="center">') and '</div>' not in intro:
    intro = intro.replace('</a>\n','</a>\n\n</div>\n',1)
usage = readme[readme.index('## 실행'):readme.index('## 0.3.3')]
Path('docs').mkdir(exist_ok=True)
history = readme[readme.index('## 0.3.3'):]
for old,new in moves.items():
    history = history.replace(old,new)
Path('docs/CHANGELOG.md').write_text('# 개발 변경 이력\n\n각 항목은 해당 버전의 작업 기록입니다. 현재 구조와 정책은 [개발 가이드](DEVELOPMENT.md)를 기준으로 합니다.\n\n'+history, encoding='utf-8', newline='\n')
Path('README.md').write_text(intro+usage+'## 개발 문서\n\n[구조·개발·검증 가이드](docs/DEVELOPMENT.md) · [개발 변경 이력](docs/CHANGELOG.md)\n\n작업 브랜치는 `main` 하나만 사용합니다. Actions 검증은 자동 실행하지 않으며, 필요한 시점에 `Verify`를 직접 실행합니다.\n', encoding='utf-8', newline='\n')
Path('docs/DEVELOPMENT.md').write_text('''# 개발 가이드

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
''', encoding='utf-8', newline='\n')
Path('.prettierignore').write_text('node_modules/\ndist/\noutput/\nverification-logs/\n', encoding='utf-8', newline='\n')
Path('tests/unit/electron/repository-layout.test.mjs').write_text('''import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
async function sourceFiles(relative) {
  const dir = new URL(relative, root);
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = relative + entry.name;
    if (entry.isDirectory()) return sourceFiles(path + "/");
    return /\\.(?:ts|tsx|cts)$/.test(entry.name) ? [path] : [];
  }));
  return nested.flat();
}

test("source root is organized by runtime responsibility", async () => {
  assert.deepEqual((await readdir(new URL("src/", root))).sort(), ["annotation", "electron", "renderer", "shared"]);
});

test("renderer imports shared contracts instead of Electron implementations", async () => {
  for (const path of await sourceFiles("src/renderer/")) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.doesNotMatch(source, /from\\s+["'][^"']*(?:@\\/electron\\/|\\.\\.\\/electron\\/)/, path);
    assert.doesNotMatch(source, /from\\s+["'](?:electron|node:[^"']+)["']/, path);
  }
});

test("shared modules do not depend on desktop or UI implementations", async () => {
  for (const path of await sourceFiles("src/shared/")) {
    const source = await readFile(new URL(path, root), "utf8");
    assert.doesNotMatch(source, /from\\s+["'](?:electron|node:[^"']+|react)["']/, path);
    assert.doesNotMatch(source, /from\\s+["'][^"']*\\/(?:electron|renderer)\\//, path);
  }
});
''', encoding='utf-8', newline='\n')
for p in sorted(Path('src').rglob('*'),key=lambda p:len(p.parts),reverse=True):
    if p.is_dir() and not any(p.iterdir()):
        p.rmdir()
print(json.dumps(moves,indent=2))
assert len(moves) == 43, len(moves)
print('Moved',len(moves),'files without compatibility wrappers.')
