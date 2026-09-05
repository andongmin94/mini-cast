"""One-use, fail-closed application of reviewed in-repository text editing source.
The verification job removes this file after validating the resulting product.
"""
from pathlib import Path
import json
import subprocess

package_path = Path('package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
guard = 'node -e "throw new Error(\'Text editing preparation incomplete; refusing old-source verification\')"'
package['scripts']['precheck'] = guard
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
try:
    source_commit = 'b12cc23f319f459b8cab77a55e7b5ee263b4264b'
    subprocess.run(['git', 'fetch', '--no-tags', '--depth=1', 'origin', source_commit], check=True)
    source = subprocess.check_output(['git', 'show', source_commit + ':.github/reorganize.py']).decode('utf-8')
    needle = "write('tests/unit/annotation/text-edit.test.mjs',"
    extra = r'''change('src/electron/testing/smoke.ts', '    Escape: 0x1b,', '    Escape: 0x1b,\n    Enter: 0x0d,')
write('tests/unit/electron/text-edit-shortcuts.test.mjs', ''' + "'''" + r'''import assert from "node:assert/strict";
import test from "node:test";
import { shortcutVirtualKeys } from "../../../dist/electron/testing/smoke.js";
test("native text-save shortcut injects Control and Enter", () => {
  assert.deepEqual(shortcutVirtualKeys("Ctrl+Enter"), [0x11, 0x0d]);
});
''' + "'''" + r''')

'''
    if source.count(needle) != 1:
        raise RuntimeError('Reviewed text editing insertion target is not unique')
    source = source.replace(needle, extra + needle)
    source = source.replace("change('README.md', '#', '#', count=read('README.md').count('#'))\n", '')
    exec(compile(source, '<reviewed-existing-text-editing>', 'exec'))
    change('src/annotation/errors.ts', 'const DOMAIN_MESSAGES = {', '''const DOMAIN_MESSAGES = {
  "unavailable": "Annotation editing is currently unavailable",
  "stale-gesture": "Annotation edit session expired or was cancelled",''')
    change('src/electron/testing/text-edit-smoke.ts', '  const controller = mainWindow;', '  const candidateController = mainWindow;')
    change('src/electron/testing/text-edit-smoke.ts',
           '  if (!controller || !overlay) throw new Error("Missing text editor test windows");',
           '  if (!candidateController || !overlay) throw new Error("Missing text editor test windows");\n  const controller = candidateController;')
    change('src/electron/testing/text-edit-smoke.ts',
           '  await openEditor(); await setText("취소할 내용");',
           '  const beforeCancel = state();\n  await openEditor(); await setText("취소할 내용");')
    change('src/electron/testing/text-edit-smoke.ts',
           '  assert.deepEqual(state(), edited);',
           '  assert.deepEqual(state(), beforeCancel);')
    final = json.loads(package_path.read_text(encoding='utf-8'))
    if final['version'] != '0.8.0' or 'precheck' in final['scripts']:
        raise RuntimeError('Text editing preparation did not finish')
except BaseException:
    failed = json.loads(package_path.read_text(encoding='utf-8'))
    failed['scripts']['precheck'] = guard
    package_path.write_text(json.dumps(failed, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    raise
