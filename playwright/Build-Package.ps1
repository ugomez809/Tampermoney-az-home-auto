param([string]$OutputDirectory = (Split-Path -Parent $PSScriptRoot), [string]$ProfileSnapshot, [string]$TampermonkeyManifest)
$ErrorActionPreference = 'Stop'
if (-not $ProfileSnapshot) {
& (Join-Path $PSScriptRoot 'owned-browser.ps1') -CheckOnly
if ($LASTEXITCODE -ne 0) { throw 'Run STOP.bat and wait for this browser to close before packaging.' }
$stateDir = Join-Path $PSScriptRoot 'monitor-state'
if ((Test-Path -LiteralPath (Join-Path $stateDir 'installation.json')) -and -not (Test-Path -LiteralPath (Join-Path $stateDir 'paused'))) { throw 'Pause with STOP.bat before packaging so Windows cannot reopen the browser during the copy.' }
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  $TampermonkeyManifest = Join-Path $stateDir 'package-tampermonkey-manifest.json'
  & (Join-Path $PSScriptRoot 'runtime\node.exe') (Join-Path $PSScriptRoot 'verify-tampermonkey.cjs') --capture $TampermonkeyManifest
  if ($LASTEXITCODE -ne 0) { throw 'Could not inventory the current installed scripts and storage.' }
} elseif (-not (Test-Path -LiteralPath (Join-Path $ProfileSnapshot 'Local State'))) { throw 'Stopped profile snapshot is incomplete.' }
if (-not $TampermonkeyManifest -or -not (Test-Path -LiteralPath $TampermonkeyManifest)) { throw 'A matching Tampermonkey inventory is required for this profile snapshot.' }
$stage = Join-Path $OutputDirectory ('GWPC-package-' + [Guid]::NewGuid().ToString('N'))
$payload = Join-Path $stage 'GWPC-Quoting'
New-Item -ItemType Directory -Path $payload -Force | Out-Null
$complete = $false
$zip = $null
try {
$excluded = @('monitor-state','startup-session-backups','Cache','Code Cache','GPUCache','DawnGraphiteCache','DawnWebGPUCache','ShaderCache','GrShaderCache','Sessions','Crashpad')
foreach ($item in Get-ChildItem -LiteralPath $PSScriptRoot -Force) {
  if ($item.Name -like 'monitor-test-*' -or $item.Name -in @('migration','MIGRATION-NOT-READY.txt','package-manifest.json') -or $excluded -contains $item.Name) { continue }
  $destination = Join-Path $payload $item.Name
  if ($item.PSIsContainer) {
    $copySource = $item.FullName
    if ($item.Name -eq 'browser-profile' -and $ProfileSnapshot) { $copySource = $ProfileSnapshot }
    & robocopy.exe $copySource $destination /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD $excluded /XF lockfile SingletonLock SingletonCookie SingletonSocket 'DevToolsActivePort' '*.pma' | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copy failed: $($item.Name)" }
  } else { Copy-Item -LiteralPath $item.FullName -Destination $destination }
}
$sourceExports = Join-Path (Split-Path -Parent $PSScriptRoot) 'Need fixing'
Copy-Item -LiteralPath $TampermonkeyManifest -Destination (Join-Path $payload 'tampermonkey-manifest.json') -Force
if (Test-Path -LiteralPath $sourceExports) {
  & robocopy.exe $sourceExports (Join-Path $payload 'source-exports') /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'Source export copy failed.' }
}
& (Join-Path $PSScriptRoot 'Migrate-ProfileKey.ps1') -Mode Export -ProfileRoot (Join-Path $payload 'browser-profile') -KeyFile (Join-Path $payload 'migration\profile-key.bin')
& (Join-Path $payload 'runtime\node.exe') (Join-Path $payload 'verify-passwords.cjs') (Join-Path $payload 'browser-profile') (Join-Path $payload 'migration\profile-key.bin')
if ($LASTEXITCODE -ne 0) { throw 'Credential verification failed; ZIP was not produced.' }
& (Join-Path $payload 'runtime\node.exe') (Join-Path $payload 'verify-cookies.cjs') (Join-Path $payload 'browser-profile') (Join-Path $payload 'migration\profile-key.bin')
if ($LASTEXITCODE -ne 0) { throw 'Cookie verification failed; ZIP was not produced.' }
@{ packagedAt=(Get-Date).ToString('o'); source=$PSScriptRoot; architecture='Windows x64'; credentialsIncluded=$true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $payload 'package-info.json')
& (Join-Path $payload 'runtime\node.exe') (Join-Path $payload 'verify-package.cjs') --create
if ($LASTEXITCODE -ne 0) { throw 'Package manifest creation failed.' }
& (Join-Path $payload 'runtime\node.exe') (Join-Path $payload 'verify-package.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Package contents failed integrity verification.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $OutputDirectory ('GWPC-Quoting-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8) + '.zip')
if (Test-Path -LiteralPath $zip) { $zip = $null; throw 'Output archive already exists; preserving it.' }
[IO.Compression.ZipFile]::CreateFromDirectory($payload,$zip,[IO.Compression.CompressionLevel]::Optimal,$false)
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  foreach ($required in @('INSTALL.bat','Install.ps1','Install-User.ps1','runtime/node.exe','node_modules/playwright/package.json','browser-engine/gwpc-lab.exe','migration/profile-key.bin','browser-profile/Default/Login Data','extension/manifest.json','supervisor.cjs','prepare-tampermonkey.cjs','Select-ExtensionFolder.ps1','tampermonkey-manifest.json','package-manifest.json')) {
    if (-not ($archive.Entries | Where-Object { $_.FullName.Replace('\','/') -eq $required })) { throw "ZIP is missing $required" }
  }
} finally { $archive.Dispose() }
Get-FileHash -LiteralPath $zip -Algorithm SHA256 | Select-Object Path,Hash | ConvertTo-Json | Set-Content -LiteralPath ($zip + '.sha256.json')
Write-Host "Package created and verified: $zip"
Write-Host 'This private ZIP includes saved credentials. Do not publish it.'
$complete = $true
} finally {
# Remove only the exact newly created staging folder, checked inside the output folder.
$resolvedStage = [IO.Path]::GetFullPath($stage)
$resolvedOutput = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\') + '\'
if (-not $resolvedStage.StartsWith($resolvedOutput,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedStage) -notlike 'GWPC-package-*') { throw 'Unsafe staging cleanup path.' }
Remove-Item -LiteralPath $resolvedStage -Recurse -Force
if (-not $complete -and $zip -and (Test-Path -LiteralPath $zip)) {
  $resolvedZip = [IO.Path]::GetFullPath($zip)
  if (-not $resolvedZip.StartsWith($resolvedOutput,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedZip) -notlike 'GWPC-Quoting-*.zip') { throw 'Unsafe partial ZIP cleanup path.' }
  Remove-Item -LiteralPath $resolvedZip -Force
}
}
