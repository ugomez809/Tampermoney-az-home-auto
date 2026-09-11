param([switch]$NoStart)
$ErrorActionPreference = 'Stop'

function Get-GwpcDesktopAccount([int]$SessionId) {
  $owners = @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Where-Object { $_.SessionId -eq $SessionId } | ForEach-Object {
    $owner = Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid
    if ($owner.ReturnValue -ne 0 -or -not $owner.Sid) { throw 'Could not identify the Windows Explorer desktop owner.' }
    $owner.Sid
  } | Select-Object -Unique)
  if ($owners.Count -eq 0) { throw 'No Windows Explorer desktop was found in this session. Sign in as the person who will run quoting and run INSTALL.bat from that desktop.' }
  if ($owners.Count -ne 1) { throw 'Found multiple Windows desktop owners in this session. Close the other Explorer session before installing.' }
  $sid = New-Object Security.Principal.SecurityIdentifier($owners[0])
  [pscustomobject]@{ Sid=$sid.Value; Name=$sid.Translate([Security.Principal.NTAccount]).Value; SessionId=$SessionId }
}

function Register-GwpcMonitorTask([string]$Root,$Account) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $id = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Root.ToLowerInvariant())))).Replace('-','').Substring(0,16) }
  finally { $sha.Dispose() }
  $taskName = 'GWPC-Quoting-' + $id
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $Root 'Start-Monitor.ps1') + '" -CheckOnly'
  $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $Root
  $triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $Account.Sid),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5))
  )
  $principal = New-ScheduledTaskPrincipal -UserId $Account.Sid -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
  $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  $existingSid = $null
  if ($existing) {
    $existingSid = $existing.Principal.UserId
    if ($existingSid -notmatch '^S-1-') {
      try { $existingSid = (New-Object Security.Principal.NTAccount($existingSid)).Translate([Security.Principal.SecurityIdentifier]).Value }
      catch { throw 'The existing scheduled task belongs to an unrecognized Windows user.' }
    }
  }
  if ($existing -and (@($existing.Actions | Where-Object { $_.Arguments -ne $arguments -or $_.Execute -ne $powershell }).Count -or $existingSid -ne $Account.Sid)) {
    throw 'Task name belongs to a different command or Windows user. Installation stopped without replacing it.'
  }
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Checks only this isolated GWPC quoting installation every five minutes and at logon.' -Force | Out-Null
  [pscustomobject]@{ Name=$taskName; CreatedNew=(-not $existing) }
}

function Invoke-GwpcUserBootstrap([string]$Root,$Account,[string]$TaskName,[switch]$NoStart,[int]$TimeoutSeconds=240) {
  $bridgeParent = [Environment]::GetFolderPath('CommonApplicationData')
  $bridge = Join-Path $bridgeParent ('GWPC-Install-' + [Guid]::NewGuid().ToString('N'))
  $bootstrapName = 'GWPC-Install-' + [Guid]::NewGuid().ToString('N')
  $registered = $false
  $completed = $false
  New-Item -ItemType Directory -Path $bridge -ErrorAction Stop | Out-Null
  try {
    # Only this short-lived status directory receives an ACL change. The project must
    # already be readable/writable by the desktop user; do not broaden its permissions.
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    $installerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    foreach ($sidText in @($installerSid,$Account.Sid,'S-1-5-18','S-1-5-32-544') | Select-Object -Unique) {
      $sid = New-Object Security.Principal.SecurityIdentifier($sidText)
      $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
      $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $bridge -AclObject $acl
    $statusPath = Join-Path $bridge 'result.json'
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $Root 'Install-User.ps1') + '" -TaskName "' + $TaskName + '" -ExpectedUserSid "' + $Account.Sid + '" -StatusPath "' + $statusPath + '"'
    if ($NoStart) { $arguments += ' -NoStart' }
    $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $Root
    $principal = New-ScheduledTaskPrincipal -UserId $Account.Sid -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName $bootstrapName -Action $action -Principal $principal -Settings $settings -Description 'Temporary GWPC installation for the signed-in desktop user.' | Out-Null
    $registered = $true
    Write-Host "Installing profile and browser as $($Account.Name), with normal user permissions..."
    Start-ScheduledTask -TaskName $bootstrapName
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
      if (Test-Path -LiteralPath $statusPath) {
        $result = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
        if (-not $result.success) { throw ('Installation failed for the desktop user: ' + $result.message) }
        $completed = $true
        return
      }
      $info = Get-ScheduledTaskInfo -TaskName $bootstrapName
      if ($info.LastRunTime -gt (Get-Date).AddMinutes(-5) -and $info.LastTaskResult -notin @(0,267009,267011)) {
        throw "The desktop-user installer could not run (Windows task result $($info.LastTaskResult)). Extract to a permanent folder that $($Account.Name) can read and write, then run INSTALL.bat again."
      }
      Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "The desktop-user installer did not finish within $TimeoutSeconds seconds. Confirm $($Account.Name) remains signed in and can read and write this extracted folder."
  } finally {
    if ($registered) {
      if (-not $completed) { Stop-ScheduledTask -TaskName $bootstrapName -ErrorAction SilentlyContinue }
      Unregister-ScheduledTask -TaskName $bootstrapName -Confirm:$false -ErrorAction SilentlyContinue
    }
    $resolvedBridge = [IO.Path]::GetFullPath($bridge)
    $resolvedParent = [IO.Path]::GetFullPath($bridgeParent).TrimEnd('\') + '\'
    if (-not $resolvedBridge.StartsWith($resolvedParent,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedBridge) -notmatch '^GWPC-Install-[0-9a-f]{32}$') { throw 'Unsafe installer status cleanup path.' }
    Remove-Item -LiteralPath $resolvedBridge -Recurse -Force
  }
}

$root = [IO.Path]::GetFullPath($PSScriptRoot)
if ($root.StartsWith('\\')) { throw 'Extract the ZIP to a local folder before installing.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'This package requires 64-bit Windows.' }
foreach ($relative in @('Install-User.ps1','runtime\node.exe','node_modules\playwright\package.json','browser-engine\gwpc-lab.exe','extension\manifest.json','browser-profile\Default\Secure Preferences')) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $relative))) { throw "Incomplete package: $relative is missing. Extract the entire ZIP first." }
}
& (Join-Path $root 'owned-browser.ps1') -CheckOnly
if ($LASTEXITCODE -ne 0) { throw 'Close this installation using STOP.bat before running INSTALL.bat again.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isElevated = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isElevated) { $account = Get-GwpcDesktopAccount -SessionId ([Diagnostics.Process]::GetCurrentProcess().SessionId) }
else { $account = [pscustomobject]@{ Sid=$identity.User.Value; Name=$identity.Name } }
$task = $null
try {
  $task = Register-GwpcMonitorTask -Root $root -Account $account
  if ($isElevated) { Invoke-GwpcUserBootstrap -Root $root -Account $account -TaskName $task.Name -NoStart:$NoStart }
  else { & (Join-Path $root 'Install-User.ps1') -TaskName $task.Name -ExpectedUserSid $account.Sid -NoStart:$NoStart }
  Write-Host "Installation verified for $($account.Name)."
  Write-Host "Installed Windows check: $($task.Name)"
  Write-Host 'Keep this Windows user signed in and the PC awake for quoting to run.'
} catch {
  if ($task -and $task.CreatedNew) { Unregister-ScheduledTask -TaskName $task.Name -Confirm:$false -ErrorAction SilentlyContinue }
  throw
}
