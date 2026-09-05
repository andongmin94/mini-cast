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
  foreach ($name in @('open','save','affinePreserved','undoRedo','editorUndo','noOp','cancel','staleRevision','controllerReload','senderRejected')) {
    if (-not $result.diagnostics.textEditingTools.$name) { throw "Missing existing-text editing verification: $name" }
  }
  foreach ($name in @('horizontal','vertical','groupShift','undoRedo','pixels','mirroredText','delete','reload','staleRevision','emptyDisabled')) {
    if (-not $result.diagnostics.flipTools.$name) { throw "Missing flip verification: $name" }
  }
  foreach ($name in @('rectangle','ellipse','preview','settingsIsolation','interiorSelection','groupFill','unfill','undoRedo','noOp','interiorErase','reload','staleRevision','emptyDisabled')) {
    if (-not $result.diagnostics.fillTools.$name) { throw "Missing fill verification: $name" }
  }
  foreach ($name in @('laser','fadingPixels','expiry','idleStopped','historyIsolated','clear','heldUndo','heldEscape','reload','permanentWritesRejected','redoPreserved','viewportReset','clickRouting')) {
    if (-not $result.diagnostics.transientTools.$name) { throw "Missing temporary-tool verification: $name" }
  }
  foreach ($name in @('clipboard','transparent','pngFile','nativeDialog','cancel','pinnedRevision','historyIsolated','busy','senderRejected','emptyPreservesClipboard')) {
    if (-not $result.diagnostics.exportTools.$name) { throw "Missing PNG export verification: $name" }
  }
  if ($result.diagnostics.exportTools.rendering.comparisons -ne 5) { throw 'PNG scale coverage was not executed.' }
  Write-Host "ANNOTATION_CORE_DIAGNOSTICS $($file.Name)"
  Write-Host ($result | ConvertTo-Json -Depth 12 -Compress)
}
