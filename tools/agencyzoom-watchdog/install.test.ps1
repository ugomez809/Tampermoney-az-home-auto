$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'install.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count) { throw ($errors | Out-String) }
foreach($name in @('Assert-DownloadHash','Select-NodeRelease')) {
 $fn=$ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 if(!$fn) { throw "Missing $name" }; Invoke-Expression $fn.Extent.Text
}
$fixture=Join-Path $env:TEMP ('az-installer-test-'+[guid]::NewGuid()+'.txt')
[IO.File]::WriteAllText($fixture,'fixture')
try {
 $hash=(Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash
 Assert-DownloadHash $fixture $hash
 $rejected=$false
 try { Assert-DownloadHash $fixture ('0'*64) } catch { $rejected=$true }
 if(!$rejected) { throw 'Tampered download accepted' }
 $release=Select-NodeRelease (($hash.ToLower())+'  node-v24.22.3-win-x64.zip') 'x64'
 if($release.Version -ne 'v24.22.3' -or $release.Hash -ne $hash.ToLower()) { throw 'Release parsing failed' }
 $rejected=$false
 try { Select-NodeRelease (($hash.ToLower())+'  node-v24.22.3-win-x64.zip') 'arm64' } catch { $rejected=$true }
 if(!$rejected) { throw 'Wrong architecture accepted' }
 Write-Host 'PASS: installer syntax, checksum validation and architecture selection.'
} finally { Remove-Item -LiteralPath $fixture }
