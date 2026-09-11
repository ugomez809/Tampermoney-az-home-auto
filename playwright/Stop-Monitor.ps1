$ErrorActionPreference = 'Stop'
$state = Join-Path $PSScriptRoot 'monitor-state'
New-Item -ItemType Directory -Path $state -Force | Out-Null
Set-Content -LiteralPath (Join-Path $state 'paused') -Value 'Paused intentionally. START.bat resumes.'
Write-Host 'Paused. This browser will close within about 15 seconds. The five-minute check respects this pause.'
