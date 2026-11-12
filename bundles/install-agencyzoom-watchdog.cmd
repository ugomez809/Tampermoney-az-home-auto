@echo off
setlocal
set "AZ_WATCHDOG_INSTALLER_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:AZ_WATCHDOG_INSTALLER_SELF); $p=[regex]::Split($s,'(?m)^# POWERSHELL_PAYLOAD\r?$',2); if($p.Length -ne 2){throw 'Installer payload missing'}; & ([scriptblock]::Create($p[1]))"
set "AZ_SETUP_EXIT=%errorlevel%"
pause
exit /b %AZ_SETUP_EXIT%
# POWERSHELL_PAYLOAD
# Packaged into the single-file installer by build-installer.cjs.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$packageUrl='https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/e7f0ba4e88f05501c4c24d9d2aea19873349a786/bundles/agencyzoom-watchdog.zip'
$packageHash='67e635b277202235558b3ce533ba3fa75b6a19b48678fbc39d06312adbd6411d'
function Assert-DownloadHash([string]$Path,[string]$Expected) {
    if($Expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ine $Expected) { throw 'Download checksum mismatch. Installation stopped.' }
}
function Select-NodeRelease([string]$Manifest,[string]$Architecture) {
    if($Architecture -notin @('x64','arm64')) { throw 'This installer requires 64-bit Windows.' }
    $pattern='(?m)^([a-fA-F0-9]{64})\s+(node-(v24\.\d+\.\d+)-win-'+$Architecture+'\.zip)\s*$'
    $match=[regex]::Match($Manifest,$pattern)
    if(!$match.Success) { throw 'No matching Node 24 Windows download in the official checksum manifest.' }
    @{Hash=$match.Groups[1].Value;File=$match.Groups[2].Value;Version=$match.Groups[3].Value}
}
$runtime=Join-Path $env:LOCALAPPDATA 'AgencyZoomWatchdog'
$appDir=Join-Path $runtime 'App'
$nodeDir=Join-Path $runtime 'Node'
$stage=Join-Path $runtime ('Setup-'+[guid]::NewGuid().ToString('N'))
$setupMutex=New-Object Threading.Mutex($false,'Local\AgencyZoomWatchdogInstaller')
$setupLocked=$false
try {
    try { $setupLocked=$setupMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $setupLocked=$true }
    if(!$setupLocked) { throw 'Another AgencyZoom installer is already open.' }
    New-Item -ItemType Directory -Path $stage,$appDir,$nodeDir -Force | Out-Null
    Start-Transcript -Path (Join-Path $runtime 'setup.log') -Append | Out-Null
    Write-Host 'AgencyZoom watchdog setup - run as your normal Windows account.'
    $chrome=@("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe","$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
    if(!$chrome) { throw 'Google Chrome is required. Install it from https://www.google.com/chrome/ and run this installer again.' }
    $existing=Get-ScheduledTask -TaskName 'AgencyZoom Chrome Watchdog' -ErrorAction SilentlyContinue
    if($existing) {
        $existing | Disable-ScheduledTask | Out-Null
        if($existing.State -eq 'Running') { throw 'The previous watchdog check is still running. Wait a minute and run this installer again. The task is paused.' }
    }
    Write-Host 'Downloading and verifying the watchdog...'
    $archive=Join-Path $stage 'watchdog.zip'
    Invoke-WebRequest -Uri $packageUrl -OutFile $archive -UseBasicParsing -TimeoutSec 120
    Assert-DownloadHash $archive $packageHash
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $stage 'Package')
    $source=Join-Path $stage 'Package\agencyzoom-watchdog'
    foreach($name in @('watchdog.ps1','run.bat','run-hidden.vbs','check.cjs','README.md','1-open-browser.bat','2-install-task.bat','uninstall-task.bat')) {
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $appDir $name) -Force
    }
    $nodeExe=Join-Path $nodeDir 'node.exe'
    $nodeReady=$false
    if(Test-Path -LiteralPath $nodeExe) {
        $version=& $nodeExe --version
        $nodeReady=$LASTEXITCODE -eq 0 -and $version -match '^v24\.'
    }
    if(!$nodeReady) {
        Write-Host 'Installing private Node.js 24 from nodejs.org...'
        $machineArch=if($env:PROCESSOR_ARCHITEW6432){$env:PROCESSOR_ARCHITEW6432}else{$env:PROCESSOR_ARCHITECTURE}
        $arch=switch($machineArch){'AMD64'{'x64'} 'ARM64'{'arm64'} default{throw '64-bit Windows is required.'}}
        $manifest=(Invoke-WebRequest -Uri 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -UseBasicParsing -TimeoutSec 60).Content
        $release=Select-NodeRelease $manifest $arch
        $nodeZip=Join-Path $stage 'node.zip'
        Invoke-WebRequest -Uri ('https://nodejs.org/dist/'+$release.Version+'/'+$release.File) -OutFile $nodeZip -UseBasicParsing -TimeoutSec 300
        Assert-DownloadHash $nodeZip $release.Hash
        Expand-Archive -LiteralPath $nodeZip -DestinationPath (Join-Path $stage 'Node')
        $extracted=Join-Path $stage ('Node\'+$release.File.Replace('.zip',''))
        foreach($name in @('node.exe','LICENSE')) { Copy-Item -LiteralPath (Join-Path $extracted $name) -Destination (Join-Path $nodeDir $name) -Force }
    }
    & $nodeExe --version
    if($LASTEXITCODE -ne 0) { throw 'The private Node installation could not run.' }
    $psExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $appDir 'watchdog.ps1') -Mode Open
    if($LASTEXITCODE -ne 0) { throw 'Could not open the dedicated Chrome profile.' }
    $guide=Join-Path $appDir 'setup.html'
    @'
<!doctype html><meta charset="utf-8"><title>AgencyZoom setup</title>
<style>body{font:18px system-ui;max-width:800px;margin:60px auto;line-height:1.6}li{margin:18px 0}a{color:#1760bd}</style>
<h1>Finish AgencyZoom setup</h1>
<p>Node and the watchdog files are installed. Complete these steps in this dedicated Chrome window.</p>
<ol><li><a target="_blank" href="https://www.tampermonkey.net/?browser=chrome">Install Tampermonkey from its official Chrome Web Store link</a>. Complete Chrome's prompts and enable userscript access if Chrome requests it.</li>
<li><a target="_blank" href="https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/main/auto/az-zillow-ticket-enricher.user.js">Install the AgencyZoom Zillow userscript</a>.</li>
<li><a target="_blank" href="https://app.agencyzoom.com/referral/pipeline">Sign in to AgencyZoom</a>, set the script's field/tag targets, and confirm it runs. Your other Chrome profile's settings are not copied.</li>
<li>Return to the installer window and press ENTER. It will register and enable the five-minute scheduled task.</li></ol>
<p>While the task is enabled, closing Chrome or pressing STOP is temporary. Use Uninstall AgencyZoom Watchdog in your Start menu to remove the task for maintenance.</p>
'@ | Set-Content -LiteralPath $guide -Encoding UTF8
    Start-Process -FilePath $chrome -ArgumentList @(('--user-data-dir="'+(Join-Path $runtime 'Chrome')+'"'),'--profile-directory=Default',('"'+$guide+'"'))
    Write-Host "`nFinish the steps in the Chrome setup page. The watchdog is paused until you finish."
    $null=Read-Host 'When AgencyZoom is signed in and the userscript is working, press ENTER'
    & $psExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $appDir 'watchdog.ps1') -Mode Install
    if($LASTEXITCODE -ne 0) { throw 'Scheduled task registration failed. See setup.log.' }
    $task=Get-ScheduledTask -TaskName 'AgencyZoom Chrome Watchdog' -ErrorAction Stop
    if(!$task.Settings.Enabled) { throw 'The scheduled task was not enabled.' }
    $startMenu=Join-Path ([Environment]::GetFolderPath('Programs')) 'AgencyZoom Watchdog'
    New-Item -ItemType Directory -Path $startMenu -Force | Out-Null
    $shell=New-Object -ComObject WScript.Shell
    foreach($entry in @(@('Open AgencyZoom','1-open-browser.bat'),@('Uninstall AgencyZoom Watchdog','uninstall-task.bat'))) {
        $shortcut=$shell.CreateShortcut((Join-Path $startMenu ($entry[0]+'.lnk')))
        $shortcut.TargetPath=Join-Path $appDir $entry[1]; $shortcut.WorkingDirectory=$appDir; $shortcut.Save()
    }
    Write-Host "`nSETUP COMPLETE: checks every five minutes and at Windows logon."
    Write-Host "Files and logs: $runtime"
    Write-Host 'Keep Windows signed in and awake. Login/CAPTCHA prompts still need a person.'
} catch {
    Write-Host "`nSETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Logs: $runtime\setup.log. Any previous watchdog task remains paused; rerun this installer to finish."
    exit 1
} finally {
    if($setupLocked -and (Test-Path -LiteralPath $stage)) {
        $resolvedStage=[IO.Path]::GetFullPath($stage)
        if([IO.Path]::GetDirectoryName($resolvedStage) -ieq [IO.Path]::GetFullPath($runtime) -and [IO.Path]::GetFileName($resolvedStage) -match '^Setup-[a-f0-9]{32}$') {
            try { Remove-Item -LiteralPath $resolvedStage -Recurse -Force } catch { Write-Warning 'Temporary setup downloads could not be removed.' }
        }
    }
    try { Stop-Transcript | Out-Null } catch {}
    if($setupLocked) { $setupMutex.ReleaseMutex() }; $setupMutex.Dispose()
}
