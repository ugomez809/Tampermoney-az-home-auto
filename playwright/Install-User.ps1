param([Parameter(Mandatory=$true)][string]$TaskName,[Parameter(Mandatory=$true)][string]$ExpectedUserSid,[string]$StatusPath,[switch]$NoStart)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PSScriptRoot)
try {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if ($identity.User.Value -ne $ExpectedUserSid -or $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Profile installation must run as the signed-in desktop user without administrator privileges. Run INSTALL.bat to select the correct account.'
  }
  $state = Join-Path $root 'monitor-state'
  $installationFile = Join-Path $state 'installation.json'
  $reinstall = Test-Path -LiteralPath $installationFile
  if ($reinstall) {
    $previousInstallation = Get-Content -LiteralPath $installationFile -Raw | ConvertFrom-Json
    if (-not $previousInstallation.root -or -not [string]::Equals([IO.Path]::GetFullPath([string]$previousInstallation.root).TrimEnd('\'),$root.TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)) {
      throw 'This previously installed folder has moved. Build a fresh migration ZIP from its working installation and extract it into a new destination folder; existing script data has not been replaced.'
    }
  }
  $probePath = Join-Path $root ('.install-write-test-' + [Guid]::NewGuid().ToString('N'))
  try { [IO.File]::WriteAllText($probePath,'write access verified'); Remove-Item -LiteralPath $probePath -Force }
  catch { throw 'The signed-in desktop user cannot write to this extracted folder. Extract the entire ZIP to a permanent folder owned by that user and try again.' }
  $runtime = Join-Path $root 'runtime\node.exe'
  if (Test-Path -LiteralPath (Join-Path $root 'package-manifest.json')) {
    $verifyArguments = @((Join-Path $root 'verify-package.cjs'))
    if ($reinstall) { $verifyArguments += '--runtime' }
    & $runtime @verifyArguments
    if ($LASTEXITCODE -ne 0) { throw 'Package verification failed. Extract the entire original ZIP again into a new folder.' }
  }
  New-Item -ItemType Directory -Path $state -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $state 'paused') -Value 'Paused while installation is in progress.'
  & (Join-Path $root 'owned-browser.ps1') -CheckOnly
  if ($LASTEXITCODE -ne 0) { throw 'Close this installation using STOP.bat before installing.' }
  $profileRoot = Join-Path $root 'browser-profile'
  $migrationKey = Join-Path $root 'migration\profile-key.bin'
  if (Test-Path -LiteralPath $migrationKey) {
    foreach ($verifier in @('verify-passwords.cjs','verify-cookies.cjs')) {
      & $runtime (Join-Path $root $verifier) $profileRoot $migrationKey
      if ($LASTEXITCODE -ne 0) { throw 'Saved passwords or cookies failed credential verification. Installation stopped before changing the profile key.' }
    }
  }
  & (Join-Path $root 'Migrate-ProfileKey.ps1') -Mode Import
  # With the portable key removed, a second import verifies this Windows user can
  # actually decrypt the newly wrapped key before opening the browser.
  & (Join-Path $root 'Migrate-ProfileKey.ps1') -Mode Import
  $prepareArguments = @((Join-Path $root 'prepare-tampermonkey.cjs'))
  if ($reinstall) {
    # Stored GM values and automatically updated script versions legitimately
    # differ from the shipped snapshot after use. Preserve the current inventory.
    $currentManifest = Join-Path $state 'reinstall-tampermonkey.json'
    & $runtime (Join-Path $root 'verify-tampermonkey.cjs') --capture $currentManifest
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the currently installed Tampermonkey data. Existing scripts and storage were preserved; verify this installation before retrying.' }
    $prepareArguments += @('--manifest',$currentManifest)
  }
  & $runtime @prepareArguments
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare and verify the bundled Tampermonkey scripts for this installation.' }
  @{ taskName=$TaskName; root=$root; user=$identity.Name; userSid=$identity.User.Value; installedAt=(Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $state 'installation.json')
  if (-not $NoStart) {
    $startedAt = [DateTime]::UtcNow
    & (Join-Path $root 'Start-Monitor.ps1')
    $ready = $false
    $deadline = (Get-Date).AddSeconds(90)
    do {
      try {
        $status = Get-Content -LiteralPath (Join-Path $state 'status.json') -Raw | ConvertFrom-Json
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($status.supervisorPid)"
        $heartbeat = [DateTime]::Parse($status.checkedAt).ToUniversalTime()
        $ready = $process -and $process.ExecutablePath -eq $runtime -and $heartbeat -ge $startedAt -and $status.browserReady
      } catch { $ready = $false }
      if ($ready) { break }
      Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (-not $ready) { throw 'The installed monitor did not confirm a working browser within 90 seconds. See monitor-state\monitor.log, then rerun INSTALL.bat.' }
  }
  if ($StatusPath) {
    @{success=$true;message='Installation verified.'} | ConvertTo-Json | Set-Content -LiteralPath ($StatusPath + '.tmp')
    Move-Item -LiteralPath ($StatusPath + '.tmp') -Destination $StatusPath -Force
  }
} catch {
  if (Test-Path -LiteralPath (Join-Path $root 'monitor-state')) {
    Set-Content -LiteralPath (Join-Path $root 'monitor-state\paused') -Value 'Paused because installation did not complete.' -ErrorAction SilentlyContinue
  }
  if ($StatusPath) {
    @{success=$false;message=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath ($StatusPath + '.tmp')
    Move-Item -LiteralPath ($StatusPath + '.tmp') -Destination $StatusPath -Force
    exit 1
  }
  throw
}
