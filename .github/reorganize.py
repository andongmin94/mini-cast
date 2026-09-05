"""Apply the reviewed flip increment and update the obsolete pre-flip validation fixture.
The opt-in Windows job validates the working tree before committing it and removes
this preparation file. An incomplete preparation fails the subsequent npm check.
"""
from pathlib import Path
import json
import subprocess

SOURCE_COMMIT = '1270813814e8efc6283853a580b2937867566b3d'

def write_guard():
    p = Path('package.json')
    data = json.loads(p.read_text(encoding='utf-8'))
    data['scripts']['precheck'] = "node -e \"throw new Error('Flip source preparation incomplete; publication prohibited')\""
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

write_guard()
try:
    subprocess.run(['git', 'fetch', '--no-tags', '--depth=1', 'origin', SOURCE_COMMIT], check=True)
    source = subprocess.check_output(['git', 'show', SOURCE_COMMIT + ':.github/reorganize.py']).decode('utf-8')
    namespace = {'__name__': '__main__'}
    exec(compile(source, 'reviewed-flip-preparation', 'exec'), namespace)
    p = Path('tests/unit/annotation/shapes-and-text.test.mjs')
    tests = p.read_text(encoding='utf-8')
    old = 'textControlPoints(point(20,20), -1, 1)'
    assert tests.count(old) == 1
    # Reflection is now valid; zero scale must remain invalid.
    tests = tests.replace(old, 'textControlPoints(point(20,20), 0, 1)')
    tests += '''\n\ntest("text validation accepts reflected frames and still rejects either collapsed axis", () => {
  for (const [sx, sy] of [[-1, 1], [1, -1], [-1, -1]]) {
    assert.equal(isAnnotationElement({ ...text(), points: textControlPoints(point(20, 20), sx, sy) }), true);
  }
  for (const [sx, sy] of [[0, 1], [1, 0], [0, 0]]) {
    assert.equal(isAnnotationElement({ ...text(), points: textControlPoints(point(20, 20), sx, sy) }), false);
  }
});\n'''
    p.write_text(tests, encoding='utf-8', newline='\n')
    assert json.loads(Path('package.json').read_text(encoding='utf-8'))['version'] == '0.9.0'
    print('FLIP_VALIDATION_FIXTURE_UPDATED: both reflection signs accepted; collapsed frames remain rejected')
except BaseException:
    write_guard()
    raise
