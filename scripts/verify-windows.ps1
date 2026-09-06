$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$OutputDirectory = Join-Path $RepositoryRoot 'output'
$LogDirectory = Join-Path $RepositoryRoot 'verification-logs'
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

function Read-SmokeLog([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  return Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
}

function Invoke-MiniCastSmoke {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][ValidateSet('startup', 'interaction')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$Label,
    [int]$TimeoutSeconds = 45,
    [switch]$DisableHardwareAcceleration,
    [switch]$CorruptSettings
  )

  if (-not (Test-Path $Executable)) {
    throw "$Label executable was not found: $Executable"
  }

  Stop-MiniCastProcesses
  $sentinel = Join-Path $env:RUNNER_TEMP ("mini-cast-{0}-{1}.json" -f $Label, [Guid]::NewGuid())
  $stdoutLog = Join-Path $LogDirectory ("{0}-stdout.log" -f $Label)
  $stderrLog = Join-Path $LogDirectory ("{0}-stderr.log" -f $Label)
  Remove-Item $stdoutLog, $stderrLog -Force -ErrorAction SilentlyContinue
  $modeArgument = if ($Mode -eq 'interaction') {
    '--interaction-smoke-test'
  } else {
    '--smoke-test'
  }
  $userData = Join-Path $env:RUNNER_TEMP ("mini-cast-userdata-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $userData | Out-Null
  if ($CorruptSettings) {
    Set-Content -LiteralPath (Join-Path $userData 'config.json') -Value '{broken-json' -Encoding utf8
  }
  $arguments = @($modeArgument, "`"--smoke-sentinel=$sentinel`"", "`"--smoke-user-data=$userData`"")
  if ($DisableHardwareAcceleration) {
    $arguments += '--disable-hardware-acceleration'
  }
  $launcher = Start-Process -FilePath $Executable -ArgumentList $arguments -PassThru `
    -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $payload = $null

  try {
    do {
      if (Test-Path $sentinel) {
        $payload = Get-Content $sentinel -Raw | ConvertFrom-Json
        break
      }
      if ($launcher.HasExited) {
        $graceDeadline = [DateTime]::UtcNow.AddSeconds(2)
        do {
          if (Test-Path $sentinel) {
            $payload = Get-Content $sentinel -Raw | ConvertFrom-Json
            break
          }
          Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $graceDeadline)
        if ($null -ne $payload) { break }

        $stdout = Read-SmokeLog $stdoutLog
        $stderr = Read-SmokeLog $stderrLog
        throw "$Label launcher exited with code $($launcher.ExitCode) before producing a smoke sentinel.`nSTDOUT:`n$stdout`nSTDERR:`n$stderr"
      }
      Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)

    if ($null -eq $payload) {
      $stdout = Read-SmokeLog $stdoutLog
      $stderr = Read-SmokeLog $stderrLog
      throw "$Label did not produce its smoke sentinel within $TimeoutSeconds seconds.`nSTDOUT:`n$stdout`nSTDERR:`n$stderr"
    }
    if (-not $payload.success) {
      $stdout = Read-SmokeLog $stdoutLog
      $stderr = Read-SmokeLog $stderrLog
      throw "$Label reported smoke failure: $($payload.error)`nSTDOUT:`n$stdout`nSTDERR:`n$stderr"
    }
    if ([bool]$payload.hardwareAccelerationDisabled -ne [bool]$DisableHardwareAcceleration) {
      throw "$Label did not run with the requested rendering mode."
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
    if (-not $payload.trayCreated) { throw "$Label skipped the production tray." }
    if ([bool]$payload.settingsRecovered -ne [bool]$CorruptSettings) {
      throw "$Label did not handle its settings fixture as expected."
    }
    if ((Get-Content -LiteralPath (Join-Path $userData 'quit-publication.txt') -Raw) -ne 'complete') { throw "$Label did not complete its pending publication before quit." }
    $saved = Get-Content -LiteralPath (Join-Path $userData 'config.json') -Raw | ConvertFrom-Json
    if ($saved.settings.cursorSize -ne $payload.expectedQuitCursorSize) {
      throw "$Label did not flush the final preference on normal quit."
    }
    Write-Host "${Label}: normal quit, preferences flush and tray initialization verified."
    Copy-Item -LiteralPath $sentinel -Destination (Join-Path $LogDirectory "$Label-sentinel.json") -Force
  }
  finally {
    if (Test-Path $sentinel) {
      Copy-Item -LiteralPath $sentinel -Destination (Join-Path $LogDirectory "$Label-sentinel.json") -Force
    }
    Remove-Item $sentinel -Force -ErrorAction SilentlyContinue
    Stop-MiniCastProcesses
    Remove-Item -LiteralPath $userData -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Read-MsiLogProperty {
  param(
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $content = Get-Content -LiteralPath $LogPath -Raw
  $pattern = '(?m)^Property\(S\):\s*' + [regex]::Escape($Name) + '\s*=\s*(.+?)\s*$'
  $match = [regex]::Match($content, $pattern)
  if (-not $match.Success) {
    throw "MSI log property '$Name' was not found in $LogPath."
  }
  return $match.Groups[1].Value.Trim()
}

function Get-MiniCastUninstallEntryByProductCode([string]$ProductCode) {
  $paths = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  return Get-ItemProperty $paths -ErrorAction SilentlyContinue |
    Where-Object {
      $childName = $_.PSObject.Properties['PSChildName']
      $childName -and ([string]$childName.Value -ieq $ProductCode)
    } |
    Select-Object -First 1
}

Stop-MiniCastProcesses

$package = Get-Content (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json
$unpackedExecutable = Join-Path $OutputDirectory 'win-unpacked\MiniCast.exe'
$portableExecutable = Join-Path $OutputDirectory 'MiniCast.exe'
$msi = Join-Path $OutputDirectory ("MiniCast-{0}-x64.msi" -f $package.version)

if (-not (Test-Path $unpackedExecutable)) { throw 'win-unpacked MiniCast.exe was not produced.' }
if (-not (Test-Path $portableExecutable)) { throw 'Portable MiniCast.exe was not produced.' }
if (-not (Test-Path $msi)) { throw "Expected MSI package was not produced: $msi" }

Write-Host 'Verifying unpacked startup with the default rendering path...'
Invoke-MiniCastSmoke -Executable $unpackedExecutable -Mode startup -Label 'unpacked-startup'
Write-Host 'Verifying the explicit software-rendering fallback...'
Invoke-MiniCastSmoke -Executable $unpackedExecutable -Mode startup -Label 'unpacked-software-startup' -DisableHardwareAcceleration
Write-Host 'Verifying real Windows click-through and annotation routing...'
Invoke-MiniCastSmoke -Executable $unpackedExecutable -Mode interaction -Label 'unpacked-interaction' -TimeoutSeconds 210
Write-Host 'Verifying annotation routing with the software-rendering fallback...'
Invoke-MiniCastSmoke -Executable $unpackedExecutable -Mode interaction -Label 'unpacked-software-interaction' -TimeoutSeconds 210 -DisableHardwareAcceleration
Write-Host 'Verifying recovery of an actually corrupt settings file...'
Invoke-MiniCastSmoke -Executable $unpackedExecutable -Mode startup -Label 'corrupt-settings-startup' -CorruptSettings
Write-Host 'Verifying portable launcher startup and complete shutdown...'
Invoke-MiniCastSmoke -Executable $portableExecutable -Mode startup -Label 'portable-startup' -TimeoutSeconds 75

$installLog = Join-Path $LogDirectory 'msi-install.log'
$uninstallLog = Join-Path $LogDirectory 'msi-uninstall.log'
$installArguments = "/i `"$msi`" /qn /norestart /L*v `"$installLog`""
Write-Host 'Installing MSI silently...'
$install = Start-Process 'msiexec.exe' -ArgumentList $installArguments -Wait -PassThru
if ($install.ExitCode -notin @(0, 3010)) {
  throw "MSI installation failed with exit code $($install.ExitCode)."
}

$productCode = Read-MsiLogProperty -LogPath $installLog -Name 'ProductCode'
$applicationFolder = Read-MsiLogProperty -LogPath $installLog -Name 'APPLICATIONFOLDER'
if ($productCode -notmatch '^\{[0-9A-Fa-f-]+\}$') {
  throw "MSI ProductCode is invalid: $productCode"
}
$entry = Get-MiniCastUninstallEntryByProductCode $productCode
if (-not $entry) {
  throw "MiniCast uninstall registry entry was not created for $productCode."
}
$installedExecutable = Join-Path $applicationFolder 'MiniCast.exe'
if (-not (Test-Path $installedExecutable)) {
  throw "Installed MiniCast.exe could not be located: $installedExecutable"
}
Write-Host "Verifying installed executable: $installedExecutable"
Invoke-MiniCastSmoke -Executable $installedExecutable -Mode startup -Label 'msi-installed-startup'

$uninstallArguments = "/x `"$productCode`" /qn /norestart /L*v `"$uninstallLog`""
Write-Host 'Removing MSI silently...'
$uninstall = Start-Process 'msiexec.exe' -ArgumentList $uninstallArguments -Wait -PassThru
if ($uninstall.ExitCode -notin @(0, 1605, 3010)) {
  throw "MSI removal failed with exit code $($uninstall.ExitCode)."
}

Wait-ForNoMiniCastProcess
$removalDeadline = [DateTime]::UtcNow.AddSeconds(15)
do {
  $entryRemains = [bool](Get-MiniCastUninstallEntryByProductCode $productCode)
  $folderRemains = Test-Path $applicationFolder
  if (-not $entryRemains -and -not $folderRemains) { break }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $removalDeadline)
if (Get-MiniCastUninstallEntryByProductCode $productCode) {
  throw "MiniCast uninstall registry entry remains after removal: $productCode"
}
if (Test-Path $applicationFolder) {
  throw "MiniCast installation folder remains after MSI removal: $applicationFolder"
}

$shortcutRoots = @(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  [Environment]::GetFolderPath('StartMenu'),
  [Environment]::GetFolderPath('CommonStartMenu')
) | Where-Object { $_ -and (Test-Path $_) }
$remainingShortcuts = @(
  $shortcutRoots |
    ForEach-Object {
      Get-ChildItem -LiteralPath $_ -Recurse -Filter 'MiniCast*.lnk' -ErrorAction SilentlyContinue
    }
)
if ($remainingShortcuts.Count -gt 0) {
  $shortcutList = $remainingShortcuts.FullName -join "`n"
  throw "MiniCast shortcuts remain after MSI removal:`n$shortcutList"
}

Write-Host 'All Windows package, input-routing, install, and removal checks passed.'
