// Generate a single CMD with a pinned, checksum-verified PowerShell payload.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [revision,output]=process.argv.slice(2);
if(!/^[a-f0-9]{40}$/.test(revision||'')||!output) throw Error('Usage: node build-installer.cjs <package commit> <output.cmd>');
const zip=fs.readFileSync(path.join(__dirname,'../../bundles/agencyzoom-watchdog.zip'));
const hash=crypto.createHash('sha256').update(zip).digest('hex');
const payload=fs.readFileSync(path.join(__dirname,'install.ps1'),'utf8')
 .replace('__PACKAGE_URL__',`https://raw.githubusercontent.com/ugomez809/Tampermoney-az-home-auto/${revision}/bundles/agencyzoom-watchdog.zip`)
 .replace('__PACKAGE_SHA256__',hash);
const header=`@echo off
setlocal
set "AZ_WATCHDOG_INSTALLER_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:AZ_WATCHDOG_INSTALLER_SELF); $p=[regex]::Split($s,'(?m)^# POWERSHELL_PAYLOAD\\r?$',2); if($p.Length -ne 2){throw 'Installer payload missing'}; & ([scriptblock]::Create($p[1]))"
set "AZ_SETUP_EXIT=%errorlevel%"
pause
exit /b %AZ_SETUP_EXIT%
# POWERSHELL_PAYLOAD
`;
fs.writeFileSync(output,(header+payload).replace(/\r?\n/g,'\r\n'));
console.log(`Created ${output}; package SHA256 ${hash}`);
