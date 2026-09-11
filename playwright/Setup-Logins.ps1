$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Stop-Monitor.ps1')
$runtime = Join-Path $PSScriptRoot 'runtime\node.exe'
$entry = Join-Path $PSScriptRoot 'supervisor.cjs'
$deadline = (Get-Date).AddSeconds(30)
do {
  $running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $runtime -and $_.CommandLine -and $_.CommandLine.Contains($entry) }
  if (-not $running) { break }
  Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline)
if ($running) { throw 'Supervisor has not stopped. Close this job before opening login setup.' }
Write-Host 'Check Tampermonkey settings and sign into AgencyZoom/Farmers as needed. Close the browser, then run START.bat.'
& $runtime (Join-Path $PSScriptRoot 'launch.cjs') --setup
if ($LASTEXITCODE -ne 0) { throw 'Login setup failed.' }
