param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$expected = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'browser-engine\gwpc-lab.exe'))
$owned = @(Get-CimInstance Win32_Process -Filter "Name='gwpc-lab.exe'" | Where-Object { $_.ExecutablePath -and [string]::Equals($_.ExecutablePath, $expected, [StringComparison]::OrdinalIgnoreCase) })
if ($CheckOnly) { if ($owned.Count) { exit 2 }; exit 0 }
foreach ($candidate in $owned) {
  $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($candidate.ProcessId)"
  if ($current -and $current.CreationDate -eq $candidate.CreationDate -and $current.ExecutablePath -eq $expected) {
    Stop-Process -Id $candidate.ProcessId -Force -ErrorAction SilentlyContinue
  }
}
