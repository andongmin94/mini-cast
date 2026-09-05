$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location (Split-Path -Parent $PSScriptRoot)

$sentinel = Join-Path $env:RUNNER_TEMP ("mini-cast-source-" + [Guid]::NewGuid() + '.json')
$userData = Join-Path $env:RUNNER_TEMP ("mini-cast-source-userdata-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $userData, 'verification-logs' | Out-Null
if (-not (Test-Path -LiteralPath 'dist/electron/main.js')) { throw 'Compiled Electron entrypoint is missing.' }
& .\node_modules\.bin\electron.cmd . --interaction-smoke-test "--smoke-sentinel=$sentinel" "--smoke-user-data=$userData"
$exitCode = $LASTEXITCODE
if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Source interaction did not return its diagnostic result.' }
$payload = Get-Content -LiteralPath $sentinel -Raw | ConvertFrom-Json
Copy-Item -LiteralPath $sentinel -Destination 'verification-logs/source-canvas.json'
Write-Host ($payload | ConvertTo-Json -Depth 12 -Compress)
if ($exitCode -ne 0 -or -not $payload.success) { throw "Source interaction failed: $($payload.error)" }
if (-not $payload.diagnostics.textEditingTools.save) { throw 'Existing-text editing was not verified.' }
if (-not $payload.diagnostics.fillTools.interiorErase) { throw 'Shape-fill authoring/editing was not verified.' }
if (-not $payload.diagnostics.dirtyCanvasReference.success -or -not $payload.diagnostics.deltaTransport.gapRecovered) {
  throw 'Source Canvas/delta coverage was not executed.'
}

if (-not $payload.diagnostics.flipTools.horizontal -or -not $payload.diagnostics.flipTools.vertical -or -not $payload.diagnostics.flipTools.groupShift) {
  throw 'Native selection flip coverage was not executed.'
}
