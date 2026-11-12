param([ValidateSet('Check','Open','Install','Uninstall')][string]$Mode='Check')
$ErrorActionPreference='Stop'
$taskName='AgencyZoom Chrome Watchdog'
$runtime=Join-Path $env:LOCALAPPDATA 'AgencyZoomWatchdog'
$automationProfile=Join-Path $runtime 'Chrome'
$stateFile=Join-Path $runtime 'state.json'
$logFile=Join-Path $runtime 'watchdog.jsonl'
New-Item -ItemType Directory -Path $automationProfile -Force | Out-Null
function Write-Log($action,$detail) {
    if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 10MB) {
        Move-Item -LiteralPath $logFile -Destination ($logFile+'.previous') -Force
    }
    @{at=(Get-Date).ToString('o');action=$action;detail=$detail} | ConvertTo-Json -Compress -Depth 12 | Add-Content -LiteralPath $logFile -Encoding UTF8
}
$chrome=@("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
function Get-OwnedBrowser {
    $arg='(?:^|\s)--user-data-dir="'+[regex]::Escape($automationProfile)+'"(?:\s|$)'
    @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object {
        $_.ExecutablePath -ieq $chrome -and $_.CommandLine -match $arg -and $_.CommandLine -notmatch '(?:^|\s)--type='
    })
}
function Open-Browser {
    if(Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile }
    Start-Process -FilePath $chrome -ArgumentList @(('--user-data-dir="'+$automationProfile+'"'),'--profile-directory=Default','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--new-window','https://app.agencyzoom.com/referral/pipeline')
    Write-Log 'opened' 'Opened visible dedicated Chrome at AgencyZoom; next check establishes baseline.'
}
function Restart-Browser {
    $roots=@(Get-OwnedBrowser)
    foreach($root in $roots) {
        $process=Get-Process -Id $root.ProcessId -ErrorAction SilentlyContinue
        if($process) { $null=$process.CloseMainWindow() }
    }
    Start-Sleep -Seconds 5
    # Revalidate exact executable and dedicated data directory before killing the browser tree.
    foreach($root in (Get-OwnedBrowser)) {
        & "$env:SystemRoot\System32\taskkill.exe" /PID $root.ProcessId /T /F | Out-Null
        if($LASTEXITCODE -ne 0 -and @(Get-OwnedBrowser).Count) { throw 'Could not close dedicated Chrome' }
    }
    if(@(Get-OwnedBrowser).Count) { throw 'Dedicated Chrome is still running; refusing duplicate launch' }
    Open-Browser
}
$mutex=New-Object Threading.Mutex($false,'Local\AgencyZoomChromeWatchdog')
$locked=$false
try {
    try { $locked=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked=$true }
    if(!$locked) { exit 0 }
    if($Mode -eq 'Uninstall') {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Log 'uninstalled' 'Task removed; profile and logs retained.'
        exit 0
    }
    if(!$chrome) { throw 'Google Chrome is not installed.' }
    $node=(Get-Command node.exe -ErrorAction SilentlyContinue).Source
    if(!$node) { throw 'Install Node.js 24 LTS from https://nodejs.org/ then rerun setup.' }
    $major=[int]((& $node --version).TrimStart('v').Split('.')[0])
    if($major -lt 22) { throw 'Node.js 22 or newer is required; install Node.js 24 LTS.' }
    if($Mode -eq 'Install') {
        $action=New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument ('"'+(Join-Path $PSScriptRoot 'run-hidden.vbs')+'"') -WorkingDirectory $PSScriptRoot
        $trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5)
        $login=New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
        $principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
        $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($trigger,$login) -Principal $principal -Settings $settings -Force | Out-Null
        Write-Log 'installed' 'Runs every five minutes and at logon, only in this signed-in Windows account.'
        Write-Host 'Installed. Logs:' $logFile
        exit 0
    }
    $owned=@(Get-OwnedBrowser)
    if(!$owned.Count) { Open-Browser; exit 0 }
    if($Mode -eq 'Open') { Write-Host 'Dedicated Chrome is already open.'; exit 0 }
    # Allow initial navigation/sign-in UI to load; do not restart a newly started process.
    if(@($owned | Where-Object {$_.CreationDate -gt (Get-Date).AddSeconds(-90)}).Count) { Write-Log 'loading' 'Chrome started less than 90 seconds ago.'; exit 0 }
    $shouldRestart=$false
    try {
        $port=[int](Get-Content -LiteralPath (Join-Path $automationProfile 'DevToolsActivePort') -TotalCount 1)
        $listener=@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop | Where-Object {$_.LocalAddress -in @('127.0.0.1','::1') -and $_.OwningProcess -in $owned.ProcessId})
        if(!$listener.Count) { throw 'Debugging port is not owned by the dedicated Chrome process.' }
        $result=& $node (Join-Path $PSScriptRoot 'check.cjs') $port $stateFile 2>&1
        if($LASTEXITCODE -ne 0) { throw ($result -join ' ') }
        $record=($result -join '') | ConvertFrom-Json
        Write-Log 'snapshot' $record
        if($record.action -eq 'restart') { Write-Log 'restart' 'AgencyZoom missing, not loaded, script missing/stopped, or state unchanged since previous check.'; $shouldRestart=$true }
    } catch {
        Write-Log 'inspection-failed' $_.Exception.Message
        $shouldRestart=$true
    }
    if($shouldRestart) { Restart-Browser }
} catch { Write-Log 'error' $_.Exception.Message; Write-Error $_; exit 1 }
finally { if($locked) { $mutex.ReleaseMutex() }; $mutex.Dispose() }
