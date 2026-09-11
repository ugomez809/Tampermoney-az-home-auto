param([ValidateSet('Export','Import')][string]$Mode, [string]$ProfileRoot = (Join-Path $PSScriptRoot 'browser-profile'), [string]$KeyFile = (Join-Path $PSScriptRoot 'migration\profile-key.bin'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$statePath = Join-Path $ProfileRoot 'Local State'
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ($state.os_crypt.app_bound_encrypted_key) { throw 'App-bound encryption requires a browser-supported password export; refusing an incomplete automatic migration.' }
if ($Mode -eq 'Export') {
  $wrapped = [Convert]::FromBase64String($state.os_crypt.encrypted_key)
  if ([Text.Encoding]::ASCII.GetString($wrapped,0,5) -ne 'DPAPI') { throw 'Unsupported profile-key format.' }
  $key = [Security.Cryptography.ProtectedData]::Unprotect($wrapped[5..($wrapped.Length-1)],$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  try {
    if ($key.Length -ne 32) { throw 'Unexpected profile-key length.' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $KeyFile) -Force | Out-Null
    [IO.File]::WriteAllBytes($KeyFile,$key)
  } finally { [Array]::Clear($key,0,$key.Length) }
} else {
  if (-not (Test-Path -LiteralPath $KeyFile)) {
    # A rerun is valid only if this account can already decrypt the saved key.
    $wrapped = [Convert]::FromBase64String($state.os_crypt.encrypted_key)
    $probe = [Security.Cryptography.ProtectedData]::Unprotect($wrapped[5..($wrapped.Length-1)],$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Array]::Clear($probe,0,$probe.Length)
    return
  }
  $key = [IO.File]::ReadAllBytes($KeyFile)
  try {
    if ($key.Length -ne 32) { throw 'Invalid migration key.' }
    $wrapped = [Security.Cryptography.ProtectedData]::Protect($key,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $encoded = [Convert]::ToBase64String(([Text.Encoding]::ASCII.GetBytes('DPAPI') + $wrapped))
    # Node preserves arbitrary JSON numbers and structure in Chromium Local State.
    $env:GWPC_WRAPPED_PROFILE_KEY = $encoded
    & (Join-Path $PSScriptRoot 'runtime\node.exe') (Join-Path $PSScriptRoot 'profile-key.cjs') $statePath
    if ($LASTEXITCODE -ne 0) { throw 'Could not protect the imported browser key.' }
    Remove-Item -LiteralPath $KeyFile -Force
  } finally {
    [Array]::Clear($key,0,$key.Length)
    Remove-Item Env:\GWPC_WRAPPED_PROFILE_KEY -ErrorAction SilentlyContinue
  }
}
