$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$OutputDirectory = Join-Path $PSScriptRoot '..\output'
$LogDirectory = Join-Path $PSScriptRoot '..\verification-logs'
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

function Stop-MiniCastProcesses {
  Get-Process -Name 'MiniCast' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
}

function Wait-ForNoMiniCastProcess([int]$TimeoutSeconds = 15) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $remaining = @(Get-Process -Name 'MiniCast' -ErrorAction SilentlyContinue)
    if ($remaining.Count -eq 0) { return }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $deadline)

  $details = @(Get-Process -Name 'MiniCast' -ErrorAction SilentlyContinue |
    Select-Object Id, ProcessName, Path | Format-Table -AutoSize | Out-String)
  Stop-MiniCastProcesses
  throw "MiniCast process did not exit cleanly.`n$details"
}

function Invoke-MiniCastSmoke {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][ValidateSet('startup', 'interaction')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$Label,
    [int]$TimeoutSeconds = 45
  )

  if (-not (Test-Path $Executable)) {
    throw "$Label executable was not found: $Executable"
  }

  Stop-MiniCastProcesses
  $sentinel = Join-Path $env:RUNNER_TEMP ("mini-cast-{0}-{1}.json" -f $Label, [Guid]::NewGuid())
  $modeArgument = if ($Mode -eq 'interaction') {
    '--interaction-smoke-test'
  } else {
    '--smoke-test'
  }
  $arguments = @($modeArgument, "--smoke-sentinel=$sentinel")
  $launcher = Start-Process -FilePath $Executable -ArgumentList $arguments -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $payload = $null

  try {
    do {
      if ($launcher.HasExited -and $launcher.ExitCode -ne 0) {
        throw "$Label launcher failed with exit code $($launcher.ExitCode)."
      }
      if (Test-Path $sentinel) {
        $payload = Get-Content $sentinel -Raw | ConvertFrom-Json
        break
      }
      Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)

    if ($null -eq $payload) {
      throw "$Label did not produce its smoke sentinel within $TimeoutSeconds seconds."
    }
    if (-not $payload.success) {
      throw "$Label reported smoke failure: $($payload.error)"
    }

    Wait-ForNoMiniCastProcess -TimeoutSeconds 20
    if (-not $launcher.HasExited) {
      if (-not $launcher.WaitForExit(5000)) {
        throw "$Label launcher remained alive after the application exited."
      }
    }
    if ($launcher.ExitCode -ne 0) {
      throw "$Label launcher exited with code $($launcher.ExitCode)."
    }
  }
  finally {
    Remove-Item $sentinel -Force -ErrorAction SilentlyContinue
    Stop-MiniCastProcesses
  }
}

function Get-MiniCastUninstallEntry {
  $paths = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  return Get-ItemProperty $paths -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'MiniCast*' } |
    Select-Object -First 1
}

function Resolve-InstalledExecutable($Entry) {
  $candidates = [System.Collections.Generic.List[string]]::new()
  if ($Entry.InstallLocation) {
    $candidates.Add((Join-Path $Entry.InstallLocation 'MiniCast.exe'))
  }
  if ($Entry.DisplayIcon) {
    $displayIcon = ([string]$Entry.DisplayIcon).Trim('"') -replace ',\d+$', ''
    $candidates.Add($displayIcon)
  }
  $candidates.Add((Join-Path $env:ProgramFiles 'MiniCast\MiniCast.exe'))
  $candidates.Add((Join-Path ${env:ProgramFiles(x86)} 'MiniCast\MiniCast.exe'))
  $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\MiniCast\MiniCast.exe'))
  $candidates.Add((Join-Path $env:LOCALAPPDATA 'MiniCast\MiniCast.exe'))

  return $candidates |
    Where-Object { $_ -and (Test-Path $_) } |
    Select-Object -First 1
}

Stop-MiniCastProcesses

$unpackedExecutable = Get-ChildItem $OutputDirectory -Recurse -Filter 'MiniCast.exe' |
  Where-Object { $_.FullName -match 'win-unpacked' } |
  Select-Object -First 1
$portableExecutable = Join-Path $OutputDirectory 'MiniCast.exe'
$msi = Get-ChildItem $OutputDirectory -Filter '*.msi' | Select-Object -First 1

if (-not $unpackedExecutable) { throw 'win-unpacked MiniCast.exe was not produced.' }
if (-not (Test-Path $portableExecutable)) { throw 'Portable MiniCast.exe was not produced.' }
if (-not $msi) { throw 'MSI package was not produced.' }

Invoke-MiniCastSmoke -Executable $unpackedExecutable.FullName -Mode startup -Label 'unpacked-startup'
Invoke-MiniCastSmoke -Executable $unpackedExecutable.FullName -Mode interaction -Label 'unpacked-interaction' -TimeoutSeconds 60
Invoke-MiniCastSmoke -Executable $portableExecutable -Mode startup -Label 'portable-startup' -TimeoutSeconds 75

$installLog = Join-Path $LogDirectory 'msi-install.log'
$uninstallLog = Join-Path $LogDirectory 'msi-uninstall.log'
$installArguments = "/i `"$($msi.FullName)`" /qn /norestart /L*v `"$installLog`""
$install = Start-Process 'msiexec.exe' -ArgumentList $installArguments -Wait -PassThru
if ($install.ExitCode -notin @(0, 3010)) {
  throw "MSI installation failed with exit code $($install.ExitCode)."
}

$entry = Get-MiniCastUninstallEntry
if (-not $entry) { throw 'MiniCast uninstall registry entry was not created.' }
$installedExecutable = Resolve-InstalledExecutable $entry
if (-not $installedExecutable) { throw 'Installed MiniCast.exe could not be located.' }
Invoke-MiniCastSmoke -Executable $installedExecutable -Mode startup -Label 'msi-installed-startup'

$productCode = [string]$entry.PSChildName
$uninstallTarget = if ($productCode -match '^\{[0-9A-Fa-f-]+\}$') {
  $productCode
} else {
  $msi.FullName
}
$uninstallArguments = "/x `"$uninstallTarget`" /qn /norestart /L*v `"$uninstallLog`""
$uninstall = Start-Process 'msiexec.exe' -ArgumentList $uninstallArguments -Wait -PassThru
if ($uninstall.ExitCode -notin @(0, 1605, 3010)) {
  throw "MSI removal failed with exit code $($uninstall.ExitCode)."
}

Wait-ForNoMiniCastProcess
$removalDeadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  $entryRemains = [bool](Get-MiniCastUninstallEntry)
  $executableRemains = Test-Path $installedExecutable
  if (-not $entryRemains -and -not $executableRemains) { break }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $removalDeadline)
if (Get-MiniCastUninstallEntry) {
  throw 'MiniCast uninstall registry entry remains after removal.'
}
if (Test-Path $installedExecutable) {
  throw "Installed executable remains after MSI removal: $installedExecutable"
}

Write-Host 'All Windows package, input-routing, install, and removal checks passed.'
