$ErrorActionPreference = 'Stop'
Import-Module ScheduledTasks
$source = Join-Path $PSScriptRoot 'Install.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'Installer has PowerShell syntax errors.' }
foreach ($name in @('Get-GwpcDesktopAccount','Register-GwpcMonitorTask','Invoke-GwpcUserBootstrap')) {
  $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name },$true)
  if (-not $definition) { throw "Missing installer function: $name" }
  Invoke-Expression $definition.Extent.Text
}
function Assert($condition,[string]$message) { if (-not $condition) { throw $message } }
function Assert-Throws([scriptblock]$body,[string]$pattern) {
  $caught = $null
  try { & $body } catch { $caught = $_.Exception.Message }
  Assert ($caught -and $caught -match $pattern) "Expected failure matching $pattern"
}
$testSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Get-CimInstance { param($ClassName,$Filter) $script:explorers }
function Invoke-CimMethod { param($InputObject,$MethodName) @{ ReturnValue=0; Sid=$InputObject.TestSid } }
$script:explorers = @([pscustomobject]@{SessionId=42;TestSid=$testSid},[pscustomobject]@{SessionId=99;TestSid='S-1-5-18'})
$account = Get-GwpcDesktopAccount -SessionId 42
Assert ($account.Sid -eq $testSid) 'Must choose the desktop in the installer session, not another logged-in session.'
$script:explorers = @()
Assert-Throws { Get-GwpcDesktopAccount -SessionId 42 } 'Explorer'
$script:explorers = @([pscustomobject]@{SessionId=42;TestSid=$testSid},[pscustomobject]@{SessionId=42;TestSid='S-1-5-18'})
Assert-Throws { Get-GwpcDesktopAccount -SessionId 42 } 'multiple'
$script:captured = $null
$script:existingTask = $null
function Get-ScheduledTask { param($TaskName) $script:existingTask }
function Register-ScheduledTask { param($TaskName,$Action,$Trigger,$Principal,$Settings,$Description,[switch]$Force) $script:captured = @{ Name=$TaskName; Action=$Action; Principal=$Principal } }
$fakeRoot = Join-Path $env:TEMP ('GWPC-InstallerMock-' + [Guid]::NewGuid().ToString('N'))
$task = Register-GwpcMonitorTask -Root $fakeRoot -Account $account
$actualTaskSid = $script:captured.Principal.UserId
if ($actualTaskSid -notmatch '^S-1-') { $actualTaskSid = (New-Object Security.Principal.NTAccount($actualTaskSid)).Translate([Security.Principal.SecurityIdentifier]).Value }
Assert ($actualTaskSid -eq $account.Sid) 'Recurring task must target the selected desktop user.'
Assert ($script:captured.Principal.RunLevel -eq 0) 'Recurring task must run with limited privileges.'
Assert ($script:captured.Principal.LogonType -eq 3) 'Recurring task must use the interactive user token.'
Assert ($task.CreatedNew) 'Registration must track newly created task for rollback.'
Assert ($script:captured.Action.Arguments -like '*Start-Monitor.ps1* -CheckOnly') 'Recurring task must respect the paused marker.'
$script:existingTask = [pscustomobject]@{Actions=@($script:captured.Action);Principal=$script:captured.Principal}
$reinstall = Register-GwpcMonitorTask -Root $fakeRoot -Account $account
Assert (-not $reinstall.CreatedNew) 'Same-account reinstall must recognize a Windows-normalized account name.'
$script:existingTask = $null
$script:bootstrapOutcome = $true
$script:removedTask = $false
$script:stoppedTask = $false
function Start-ScheduledTask {
  param($TaskName)
  Assert ($script:captured.Principal.RunLevel -eq 0) 'Bootstrap must not elevate the browser or profile import.'
  Assert ($script:captured.Principal.LogonType -eq 3) 'Bootstrap must use the interactive token.'
  $matched = [regex]::Match($script:captured.Action.Arguments,'-StatusPath "([^"]+)"')
  Assert ($matched.Success) 'Bootstrap must provide a status path.'
  @{ success=$script:bootstrapOutcome; message='simulated bootstrap failure' } | ConvertTo-Json | Set-Content -LiteralPath $matched.Groups[1].Value
}
function Stop-ScheduledTask { param($TaskName) $script:stoppedTask = $true }
function Unregister-ScheduledTask { param($TaskName,[switch]$Confirm) $script:removedTask = $true }
Invoke-GwpcUserBootstrap -Root $PSScriptRoot -Account $account -TaskName $task.Name -NoStart -TimeoutSeconds 5
Assert ($script:removedTask) 'Temporary bootstrap task must be removed after success.'
Assert (-not $script:stoppedTask) 'Successful bootstrap must not stop the browser it just launched.'
$script:bootstrapOutcome = $false
$script:removedTask = $false
Assert-Throws { Invoke-GwpcUserBootstrap -Root $PSScriptRoot -Account $account -TaskName $task.Name -NoStart -TimeoutSeconds 5 } 'simulated bootstrap failure'
Assert ($script:removedTask) 'Temporary bootstrap task must be removed after failure.'
Assert ($script:stoppedTask) 'Failed bootstrap must stop its temporary task.'
Write-Output 'PASS: desktop identity, ambiguous/missing desktop rejection, limited task principals, bootstrap result propagation and cleanup.'
