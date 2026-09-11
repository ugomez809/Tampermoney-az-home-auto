param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$state = Join-Path $PSScriptRoot 'monitor-state'
New-Item -ItemType Directory -Path $state -Force | Out-Null
if ($CheckOnly -and (Test-Path -LiteralPath (Join-Path $state 'paused'))) { exit 0 }
if (-not $CheckOnly) { Remove-Item -LiteralPath (Join-Path $state 'paused') -Force -ErrorAction SilentlyContinue }
$runtime = Join-Path $PSScriptRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $runtime)) { throw 'Run INSTALL.bat first: private Node runtime missing.' }
$entry = Join-Path $PSScriptRoot 'supervisor.cjs'
$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $runtime -and $_.CommandLine -and $_.CommandLine.Contains($entry) }
foreach ($candidate in @($existing | Where-Object { $null -ne $_ })) {
  $heartbeat = $null
  try { $heartbeat = Get-Content -LiteralPath (Join-Path $state 'status.json') -Raw | ConvertFrom-Json } catch { }
  $lastActive = $candidate.CreationDate.ToUniversalTime()
  if ($heartbeat -and $heartbeat.supervisorPid -eq $candidate.ProcessId) {
    try { $lastActive = [DateTime]::Parse($heartbeat.checkedAt).ToUniversalTime() } catch { }
  }
  if (([DateTime]::UtcNow - $lastActive).TotalSeconds -gt 120) {
    $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($candidate.ProcessId)"
    if ($current -and $current.CreationDate -eq $candidate.CreationDate -and $current.ExecutablePath -eq $runtime -and $current.CommandLine.Contains($entry)) {
      Stop-Process -Id $candidate.ProcessId -Force
    }
  }
}
$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $runtime -and $_.CommandLine -and $_.CommandLine.Contains($entry) }
if (-not $existing) { Start-Process -FilePath $runtime -ArgumentList @(('"' + $entry + '"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden }
