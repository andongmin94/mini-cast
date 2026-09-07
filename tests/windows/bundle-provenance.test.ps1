$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location (Join-Path $PSScriptRoot '../..')
$bundle = @(Get-ChildItem output -Filter 'MiniCast-*-windows.zip')
if ($bundle.Count -ne 1) { throw 'Expected one validated ZIP.' }
$before = (Get-FileHash -LiteralPath $bundle[0].FullName).Hash
$source = $env:MINICAST_SOURCE_SHA
$head = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$') { throw 'Cannot identify the checked-out source HEAD.' }
if (-not $source -or $source -ne $head) { throw 'Verify did not pin MINICAST_SOURCE_SHA to the checked-out HEAD.' }
try {
  $env:MINICAST_SOURCE_SHA = '0000000000000000000000000000000000000000'
  $rejected = $false
  try { & ./scripts/package-bundle.ps1 } catch { $rejected = $_.Exception.Message -like '*requested source SHA*' }
  if (-not $rejected) { throw 'Mismatched source identity was not rejected.' }
} finally { $env:MINICAST_SOURCE_SHA = $source }
$readme = (Resolve-Path README.md).Path
$original = [IO.File]::ReadAllBytes($readme)
try {
  [IO.File]::AppendAllText($readme, "`nUNCOMMITTED_PROVENANCE_FIXTURE`n")
  $rejected = $false
  try { & ./scripts/package-bundle.ps1 } catch { $rejected = $_.Exception.Message -like '*uncommitted source tree*' }
  if (-not $rejected) { throw 'Dirty source was not rejected.' }
} finally { [IO.File]::WriteAllBytes($readme, $original) }
if ((Get-FileHash -LiteralPath $bundle[0].FullName).Hash -ne $before) { throw 'A rejected bundle attempt changed the validated ZIP.' }
& git diff --exit-code
if ($LASTEXITCODE -ne 0) { throw 'Provenance tests did not restore the source.' }
Write-Host 'BUNDLE_PROVENANCE_NEGATIVE_TESTS_PASSED pinned source, dirty source and mismatched SHA verified; original bundle unchanged.'
