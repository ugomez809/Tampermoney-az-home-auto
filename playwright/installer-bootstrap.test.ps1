$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'Install.ps1'),[ref]$tokens,[ref]$parseErrors)
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-GwpcUserBootstrap' },$true)
if (-not $definition -or $parseErrors.Count) { throw 'Installer bootstrap function is unavailable.' }
Invoke-Expression $definition.Extent.Text
$temporaryParent = [IO.Path]::GetTempPath()
$fixture = Join-Path $temporaryParent ('GWPC-Bootstrap-Test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
  @'
param($TaskName,$ExpectedUserSid,$StatusPath,[switch]$NoStart)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$correct = $identity.User.Value -eq $ExpectedUserSid -and -not $elevated
@{ sid=$identity.User.Value; elevated=$elevated; noStart=$NoStart.IsPresent } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'proof.json')
@{success=$correct;message='Fixture ran with an unexpected Windows identity or elevation.'} | ConvertTo-Json | Set-Content -LiteralPath ($StatusPath + '.tmp')
Move-Item -LiteralPath ($StatusPath + '.tmp') -Destination $StatusPath
'@ | Set-Content -LiteralPath (Join-Path $fixture 'Install-User.ps1')
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $account = [pscustomobject]@{Sid=$identity.User.Value;Name=$identity.Name}
  Invoke-GwpcUserBootstrap -Root $fixture -Account $account -TaskName 'GWPC-Fixture-NoRecurringTask' -NoStart -TimeoutSeconds 40
  $proof = Get-Content -LiteralPath (Join-Path $fixture 'proof.json') -Raw | ConvertFrom-Json
  if ($proof.sid -ne $account.Sid -or $proof.elevated -or -not $proof.noStart) { throw 'Real scheduled bootstrap did not preserve the expected account, limited token and arguments.' }
  Write-Output 'PASS: real Windows scheduled bootstrap executes as the expected non-elevated user and returns a verified result.'
} finally {
  $resolved = [IO.Path]::GetFullPath($fixture)
  if (-not $resolved.StartsWith([IO.Path]::GetFullPath($temporaryParent),[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notmatch '^GWPC-Bootstrap-Test-[0-9a-f]{32}$') { throw 'Unsafe fixture cleanup path.' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
