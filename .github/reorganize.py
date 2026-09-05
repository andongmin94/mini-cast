"""Run the reviewed shape-fill preparation with the controller projection corrected.
The immutable preparation source is in this repository's preceding commit.
A compile guard prevents the historical shell from masking preparation failure.
This file and its guard are removed before the verified product commit.
"""
from pathlib import Path
import subprocess

source_commit = 'fafccce0e7c5ffc41d4d274b34f2a564f647e118'
guard = Path('src/annotation/fill-preparation-incomplete.ts')
guard.write_text('export const preparationIncomplete: never = "shape-fill preparation incomplete";\n', encoding='utf-8')
subprocess.run(['git', 'fetch', '--depth=1', 'origin', source_commit], check=True)
source = subprocess.check_output(['git', 'show', source_commit + ':.github/reorganize.py']).decode('utf-8')
anchor = "controller = 'src/renderer/components/Controller.tsx'\n"
projection = '''settings={{
                annotationPenColor: settings.annotationPenColor,
                annotationHighlighterColor: settings.annotationHighlighterColor,
                annotationPenWidth: settings.annotationPenWidth,
                annotationHighlighterWidth: settings.annotationHighlighterWidth,
                annotationEraserWidth: settings.annotationEraserWidth,
              }}'''
if source.count(anchor) != 1:
    raise SystemExit('The reviewed controller preparation anchor changed')
source = source.replace(anchor, anchor + 'replace(controller, ' + repr(projection) + ', "settings={settings}")\n')
exec(compile(source, 'reviewed-shape-fill-preparation.py', 'exec'), {'__name__': '__main__'})
guard.unlink()
print('SHAPE_FILL_CONTROLLER_PROJECTION_VERIFIED')
