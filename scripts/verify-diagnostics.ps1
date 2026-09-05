$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location (Split-Path -Parent $PSScriptRoot)

$files = @(Get-ChildItem verification-logs -File -Filter '*interaction-sentinel.json')
if ($files.Count -ne 2) { throw "Expected both interaction diagnostics, found $($files.Count)." }
foreach ($file in $files) {
  $result = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
  if (-not $result.success -or -not $result.diagnostics.heldEraserUndo -or -not $result.diagnostics.dirtyCanvasReference.success -or -not $result.diagnostics.deltaTransport.gapRecovered) {
    throw "Missing successful delta/Canvas/cancellation checks: $($file.Name)"
  }
  if ($result.diagnostics.dirtyCanvasReference.exactPixelComparisons -lt 500) { throw 'Canvas reference coverage was reduced.' }
  foreach ($name in @('line', 'arrow', 'rectangle', 'ellipse', 'text', 'textEditorUndo', 'textReload')) {
    if (-not $result.diagnostics.shapeAndTextTools.$name) {
      throw "Missing shape/text verification '$name': $($file.Name)"
    }
  }
  foreach ($name in @('topmost','move','undoRedo','delete','heldUndo','staleRevision','reload')) {
    if (-not $result.diagnostics.selectionTools.$name) { throw "Missing selection verification: $name" }
  }
  foreach ($name in @('handles','tinyHandles','noOp','resize','undoRedo','groupShift','pixels','heldUndo','staleRevision','activeReload','heldEscape')) {
    if (-not $result.diagnostics.resizeTools.$name) { throw "Missing resize verification: $name" }
  }
  foreach ($name in @('handle','noOp','rotate','groupShift','undoRedo','pixels','heldUndo','staleRevision','activeReload','heldEscape')) {
    if (-not $result.diagnostics.rotationTools.$name) { throw "Missing rotation verification: $name" }
  }
  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"
  Write-Host ($result | ConvertTo-Json -Depth 12 -Compress)
}
