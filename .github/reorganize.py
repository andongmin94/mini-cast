"""One-run preparation with a fail-closed npm check guard.
The historical PowerShell job contains two native commands in its preparation
step. If preparation raises, its second command must not conceal the failure.
The guard below makes the subsequent check fail unless all reviewed edits finish.
"""
from pathlib import Path
import base64
import hashlib
import json
import traceback
import urllib.request

package_path = Path('package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
assert package['version'] == '0.6.0'
assert 'precheck' not in package['scripts']
package['scripts']['precheck'] = 'node -e "throw new Error(\'Rotation source preparation did not complete; refusing to validate the old product\')"'
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')

def blob_text(sha):
    request = urllib.request.Request(
        f'https://api.github.com/repos/andongmin94/mini-cast/git/blobs/{sha}',
        headers={'Accept':'application/vnd.github+json','User-Agent':'MiniCast-verification'})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = base64.b64decode(json.load(response)['content'])
    assert hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest() == sha
    return data.decode('utf-8')

try:
    source = blob_text('539adf669cd2bd0231b559614e7a45b54066e926')
    old = "Path('package.json').read_text()"
    assert source.count(old) == 1
    source = source.replace(old, "Path('package.json').read_text(encoding='utf-8')")
    exec(compile(source, 'reviewed-rotation-preparation.py', 'exec'), {'__name__':'__main__'})
    # Consolidate the guide instead of leaving obsolete feature declarations.
    Path('docs/ANNOTATION-TOOLS.md').write_text(
        blob_text('db064cc967d5d4f16ef24d38e4d7b0430dcb0e3d'), encoding='utf-8', newline='\n')
    final = json.loads(package_path.read_text(encoding='utf-8'))
    assert final['version'] == '0.7.0'
    assert Path('src/annotation/rotation.ts').is_file()
    assert Path('tests/unit/annotation/rotation.test.mjs').is_file()
    assert 'diagnostics.rotationTools' in Path('src/electron/testing/interaction-smoke.ts').read_text(encoding='utf-8')
    del final['scripts']['precheck']
    package_path.write_text(json.dumps(final, ensure_ascii=False, indent=2)+'\n', encoding='utf-8', newline='\n')
    print('ROTATION_PREPARATION_COMPLETE version=0.7.0; guard released after complete source verification')
except BaseException:
    Path('verification-logs').mkdir(exist_ok=True)
    Path('verification-logs/rotation-preparation-failure.txt').write_text(traceback.format_exc(), encoding='utf-8')
    print('ROTATION_PREPARATION_FAILED: npm precheck guard remains; publication is prohibited')
    raise
