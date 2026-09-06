$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location (Split-Path -Parent $PSScriptRoot)

function Read-Git([string[]]$Arguments) {
  $result = & git @Arguments
  if ($LASTEXITCODE -ne 0) { throw "git $Arguments failed" }
  return ($result -join "`n").Trim()
}
function Assert-CleanSource {
  $status = Read-Git -Arguments @('status', '--porcelain', '--untracked-files=normal')
  if ($status) { throw "Refusing to package an uncommitted source tree:`n$status" }
}
Assert-CleanSource
$commit = Read-Git -Arguments @('rev-parse', 'HEAD')
$tree = Read-Git -Arguments @('rev-parse', 'HEAD^{tree}')
if ($commit -notmatch '^[0-9a-f]{40}$' -or $tree -notmatch '^[0-9a-f]{40}$') { throw 'Invalid source identity.' }
if ($env:MINICAST_SOURCE_SHA -and $commit -ne $env:MINICAST_SOURCE_SHA) { throw 'Checkout differs from the requested source SHA.' }
$package = Get-Content package.json -Raw | ConvertFrom-Json
$version = $package.version
$msiName = "MiniCast-$version-x64.msi"
$expectedPackages = @($msiName, 'MiniCast.exe') | Sort-Object
$actualPackages = @(Get-ChildItem output -File | Where-Object { $_.Extension -eq '.msi' -or $_.Name -eq 'MiniCast.exe' } | Select-Object -ExpandProperty Name | Sort-Object)
if (($actualPackages -join '|') -ne ($expectedPackages -join '|')) { throw 'Output does not contain exactly the requested MSI and portable EXE.' }
$nodeVersion = node --version
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify Node.' }
# No circular ZIP hash: source metadata is inside the ZIP; its enclosing hash is external.
[ordered]@{
  commit = $commit
  tree = $tree
  workflow_commit = $env:GITHUB_SHA
  run_id = $env:GITHUB_RUN_ID
  run_attempt = $env:GITHUB_RUN_ATTEMPT
  version = $version
  electron = $package.devDependencies.electron
  node = $nodeVersion
  platform = 'windows-x64'
} | ConvertTo-Json | Set-Content -LiteralPath output/BUILD-METADATA.json -Encoding utf8NoBOM
$payloadNames = @($msiName, 'MiniCast.exe', 'BUILD-METADATA.json') | Sort-Object
$lines = $payloadNames | ForEach-Object {
  $hash = (Get-FileHash -LiteralPath (Join-Path 'output' $_) -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash *$_"
}
Set-Content -LiteralPath output/SHA256SUMS.txt -Value $lines -Encoding utf8NoBOM
$names = @($payloadNames) + 'SHA256SUMS.txt'
$bundle = Join-Path $PWD "output/MiniCast-$version-windows.zip"
$paths = @($names | ForEach-Object { (Get-Item -LiteralPath (Join-Path 'output' $_)).FullName })
Compress-Archive -LiteralPath $paths -DestinationPath $bundle -Force
$archive = [IO.Compression.ZipFile]::OpenRead($bundle)
try {
  $actualNames = @($archive.Entries | ForEach-Object { $_.FullName } | Sort-Object)
  if (($actualNames -join '|') -ne (($names | Sort-Object) -join '|')) { throw 'Unexpected or duplicate ZIP entries.' }
} finally { $archive.Dispose() }
$extract = Join-Path $env:RUNNER_TEMP ("mini-cast-bundle-" + [Guid]::NewGuid())
try {
  Expand-Archive -LiteralPath $bundle -DestinationPath $extract -Force
  $hashLines = @(Get-Content -LiteralPath (Join-Path $extract 'SHA256SUMS.txt'))
  if ($hashLines.Count -ne $payloadNames.Count) { throw 'Incomplete internal hash manifest.' }
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($line in $hashLines) {
    if ($line -notmatch '^([0-9a-f]{64}) \*([^/\\]+)$') { throw "Invalid hash record: $line" }
    $expectedHash = $Matches[1]; $name = $Matches[2]
    if ($name -notin $payloadNames -or -not $seen.Add($name)) { throw 'Invalid manifest member.' }
    $hash = (Get-FileHash -LiteralPath (Join-Path $extract $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $expectedHash) { throw "ZIP hash mismatch: $name" }
  }
  $metadata = Get-Content -LiteralPath (Join-Path $extract 'BUILD-METADATA.json') -Raw | ConvertFrom-Json
  if ($metadata.commit -ne $commit -or $metadata.tree -ne $tree -or $metadata.version -ne $version) { throw 'ZIP source metadata mismatch.' }
} finally {
  Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue
}
Assert-CleanSource
if ((Read-Git -Arguments @('rev-parse', 'HEAD')) -ne $commit) { throw 'Source changed while bundling.' }
$bundleHash = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath output/BUNDLE-SHA256.txt -Value "$bundleHash *$(Split-Path $bundle -Leaf)" -Encoding utf8NoBOM
Write-Host "BUNDLE_VERIFIED commit=$commit tree=$tree version=$version entries=4 payload_hashes=3 sha256=$bundleHash"
