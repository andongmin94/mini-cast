$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location (Split-Path -Parent $PSScriptRoot)

$files = @(Get-ChildItem output -File | Where-Object { $_.Extension -eq '.msi' -or $_.Name -eq 'MiniCast.exe' })
if ($files.Count -ne 2) { throw "Expected one MSI and one portable EXE, found $($files.Count)." }
$lines = $files | Sort-Object Name | ForEach-Object {
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash *$($_.Name)"
}
Set-Content -LiteralPath output/SHA256SUMS.txt -Value $lines -Encoding utf8

$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$msiFiles = @(Get-ChildItem output -File -Filter 'MiniCast-*-x64.msi')
if ($msiFiles.Count -ne 1) { throw "Expected one MSI, found $($msiFiles.Count)." }
$msi = $msiFiles[0]
$exe = Get-Item output/MiniCast.exe
$sums = Get-Item output/SHA256SUMS.txt
$bundle = Join-Path $PWD ("output/MiniCast-$version-windows.zip")
Compress-Archive -LiteralPath $msi.FullName, $exe.FullName, $sums.FullName -DestinationPath $bundle -Force
$extract = Join-Path $env:RUNNER_TEMP ("mini-cast-bundle-" + [Guid]::NewGuid())
Expand-Archive -LiteralPath $bundle -DestinationPath $extract -Force
try {
  $entries = @(Get-ChildItem -LiteralPath $extract -File)
  if ($entries.Count -ne 3) { throw "Expected 3 ZIP entries, found $($entries.Count)." }
  $hashLines = @(Get-Content -LiteralPath (Join-Path $extract 'SHA256SUMS.txt'))
  if ($hashLines.Count -ne 2) { throw "Expected 2 internal hashes, found $($hashLines.Count)." }
  foreach ($line in $hashLines) {
    if ($line -notmatch '^([0-9a-f]{64}) \*(.+)$') { throw "Invalid SHA256SUMS line: $line" }
    $target = Join-Path $extract $Matches[2]
    if (-not (Test-Path -LiteralPath $target)) { throw "Missing ZIP entry: $($Matches[2])" }
    $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Matches[1]) { throw "Hash mismatch for $($Matches[2])." }
  }
} finally {
  Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
}
$bundleHash = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath output/BUNDLE-SHA256.txt -Value "$bundleHash *$(Split-Path $bundle -Leaf)" -Encoding utf8
$package = Get-Content package.json -Raw | ConvertFrom-Json
@{
  commit = $env:GITHUB_SHA
  run_id = $env:GITHUB_RUN_ID
  version = $package.version
  electron = $package.devDependencies.electron
  node = (node --version)
  platform = 'windows-2022-x64'
  bundle_sha256 = $bundleHash
} | ConvertTo-Json | Set-Content -LiteralPath output/BUILD-METADATA.json -Encoding utf8
