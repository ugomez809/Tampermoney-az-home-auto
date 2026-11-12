$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'watchdog.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count) { throw ($errors | Out-String) }
$automationProfile='C:\Users\Test User\AppData\Local\AgencyZoomWatchdog\Chrome'
$chrome='C:\Program Files\Google\Chrome\Application\chrome.exe'
$stateFile=Join-Path $env:TEMP ('watchdog-test-'+[guid]::NewGuid()+'.json')
function Get-CimInstance {
 @(
  [pscustomobject]@{ProcessId=11;ExecutablePath=$chrome;CommandLine='chrome.exe --user-data-dir="'+$automationProfile+'" --remote-debugging-port=0'},
  [pscustomobject]@{ProcessId=12;ExecutablePath=$chrome;CommandLine='chrome.exe --user-data-dir="'+$automationProfile+' Other"'},
  [pscustomobject]@{ProcessId=13;ExecutablePath=$chrome;CommandLine='chrome.exe --profile-directory="Profile 1"'},
  [pscustomobject]@{ProcessId=14;ExecutablePath=$chrome;CommandLine='chrome.exe --user-data-dir="'+$automationProfile+'" --type=renderer'},
  [pscustomobject]@{ProcessId=15;ExecutablePath='C:\Other\chrome.exe';CommandLine='chrome.exe --user-data-dir="'+$automationProfile+'"'}
 )
}
function Start-Process { param($FilePath,$ArgumentList) $script:launch=@{exe=$FilePath;args=$ArgumentList} }
function Write-Log { param($action,$detail) }
foreach($name in @('Get-OwnedBrowser','Open-Browser')) {
 $fn=$ast.Find({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
 Invoke-Expression $fn.Extent.Text
}
$owned=@(Get-OwnedBrowser)
if($owned.Count -ne 1 -or $owned[0].ProcessId -ne 11) { throw 'Process isolation failed' }
Open-Browser
if($launch.exe -ne $chrome -or $launch.args.Count -ne 8) { throw 'Launch arguments were not preserved' }
if($launch.args[0] -ne ('--user-data-dir="'+$automationProfile+'"')) { throw 'Dedicated path quoting failed' }
if($launch.args -contains '--headless') { throw 'Browser must stay visible' }
Write-Host 'PASS: PowerShell syntax, exact profile/process isolation, visible launch and paths with spaces.'
