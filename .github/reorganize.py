"""Run the reviewed file increment with explicit, checked corrections; removed after verification."""
from pathlib import Path
import json
import subprocess

REVIEWED = 'a2e0e9a2c0fe53925bbd1471f2db53b528dc75a7'
guard = json.loads(Path('package.json').read_text(encoding='utf-8'))
guard['scripts']['check'] = 'node -e "throw new Error(\'Editable file preparation incomplete\')"'
Path('package.json').write_text(json.dumps(guard, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
subprocess.run(['git','fetch','--depth=1','origin',REVIEWED],check=True)
reviewed = subprocess.check_output(['git','show',REVIEWED+':.github/reorganize.py']).decode('utf-8')
fixups = r'''
replace('tests/unit/annotation/document-file.test.mjs', r'text.includes(`\"${key}\"`)', 'text.includes(JSON.stringify(key))')
replace('src/annotation/document-file.ts', '  copyAnnotationElements,', '  copyAnnotationElements,\n  isAnnotationElement,')
replace('src/annotation/document-file.ts', '      return dx === 0 && dy === 0 ? resized : translateAnnotationElement(resized, dx, dy);', ''' + '"""' + '''      const fitted = dx === 0 && dy === 0 ? resized : translateAnnotationElement(resized, dx, dy);
      if (!isAnnotationElement(fitted)) throw new AnnotationFileError("cannot-fit");
      return fitted;''' + '"""' + ''')
files['tests/unit/annotation/document-file.test.mjs'] += ''' + '"""' + '''

test("centering cannot move a valid text layout beyond coordinate limits", () => {
  const text = { ...fixture()[6], text: "A", box: { minX: 0, minY: 0, maxX: 49900, maxY: 20 },
    points: [{ x: 950000, y: 0 }, { x: 950001, y: 0 }, { x: 950000, y: 1 }] };
  const file = createAnnotationFile(setup([text]).getSnapshot(1));
  assert.throws(() => fitAnnotationFile(file, { width: 100000, height: 100 }), reason("cannot-fit"));
});
''' + '"""' + '''
'''
anchor = 'for path,value in files.items():'
assert reviewed.count(anchor) == 1
reviewed = reviewed.replace(anchor, fixups+'\n'+anchor)
exec(compile(reviewed, 'reviewed-editable-file-preparation', 'exec'))
