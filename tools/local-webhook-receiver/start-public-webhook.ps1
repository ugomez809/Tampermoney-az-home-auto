param(
  [string]$OutputDir = "$env:USERPROFILE\Documents\GWPC Payloads",
  [int]$Port = 8787,
  [string]$Route = "/gwpc-payload",
  [string]$Token = "",
  [string]$CloudflaredPath = ""
)

$ErrorActionPreference = "Stop"

function Write-PublicLog {
  param([string]$Message)
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$stamp] $Message"
}

function Normalize-Route {
  param([string]$Value)
  $routeText = ""
  if ($null -ne $Value) {
    $routeText = $Value.Trim()
  }
  if (-not $routeText.StartsWith("/")) {
    $routeText = "/$routeText"
  }
  if ($routeText.Length -gt 1 -and $routeText.EndsWith("/")) {
    $routeText = $routeText.TrimEnd("/")
  }
  return $routeText
}

function New-WebhookToken {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToBase64String($bytes) -replace '[+/=]', '')
}

function Get-TokenFilePath {
  $dir = Join-Path $env:APPDATA "GWPCLocalWebhook"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  return Join-Path $dir "public-webhook-token.txt"
}

function Resolve-WebhookToken {
  param([string]$ProvidedToken)
  if ($ProvidedToken) {
    return $ProvidedToken
  }

  $tokenFile = Get-TokenFilePath
  if (Test-Path -LiteralPath $tokenFile) {
    $existing = (Get-Content -LiteralPath $tokenFile -Raw).Trim()
    if ($existing) {
      return $existing
    }
  }

  $newToken = New-WebhookToken
  Set-Content -LiteralPath $tokenFile -Value $newToken -Encoding ASCII
  return $newToken
}

function Resolve-CloudflaredPath {
  param([string]$ProvidedPath)
  if ($ProvidedPath -and (Test-Path -LiteralPath $ProvidedPath)) {
    return [System.IO.Path]::GetFullPath($ProvidedPath)
  }

  $dir = Join-Path $env:LOCALAPPDATA "GWPCLocalWebhook"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $exe = Join-Path $dir "cloudflared.exe"
  if (Test-Path -LiteralPath $exe) {
    return $exe
  }

  $url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  Write-PublicLog "Downloading cloudflared..."
  Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
  return $exe
}

function Read-NewLines {
  param(
    [string]$Path,
    [ref]$Offset
  )
  if (-not (Test-Path -LiteralPath $Path)) {
    return @()
  }

  $text = Get-Content -LiteralPath $Path -Raw
  if ($null -eq $text) {
    $text = ""
  }
  if ($text.Length -le $Offset.Value) {
    return @()
  }

  $chunk = $text.Substring($Offset.Value)
  $Offset.Value = $text.Length
  return ($chunk -split "`r?`n") | Where-Object { $_ }
}

$Route = Normalize-Route $Route
$Token = Resolve-WebhookToken -ProvidedToken $Token
$cloudflared = Resolve-CloudflaredPath -ProvidedPath $CloudflaredPath
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$receiverScript = Join-Path $scriptDir "start-local-webhook.ps1"
$stateDir = Join-Path $env:LOCALAPPDATA "GWPCLocalWebhook"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$receiverOut = Join-Path $stateDir "receiver-public.out.log"
$receiverErr = Join-Path $stateDir "receiver-public.err.log"
$tunnelOut = Join-Path $stateDir "cloudflared.out.log"
$tunnelErr = Join-Path $stateDir "cloudflared.err.log"
Remove-Item -LiteralPath $receiverOut,$receiverErr,$tunnelOut,$tunnelErr -Force -ErrorAction SilentlyContinue

Write-PublicLog "Starting token-protected local receiver..."
$receiver = Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  $receiverScript,
  "-OutputDir",
  $OutputDir,
  "-Port",
  [string]$Port,
  "-Route",
  $Route,
  "-Token",
  $Token
) -WindowStyle Hidden -RedirectStandardOutput $receiverOut -RedirectStandardError $receiverErr -PassThru

Start-Sleep -Seconds 2
if ($receiver.HasExited) {
  Write-Host ""
  Write-Host "Receiver failed to start. Output:"
  if (Test-Path -LiteralPath $receiverOut) { Get-Content -LiteralPath $receiverOut }
  if (Test-Path -LiteralPath $receiverErr) { Get-Content -LiteralPath $receiverErr }
  exit 1
}

Write-PublicLog "Starting Cloudflare quick tunnel..."
$originUrl = "http://127.0.0.1:$Port"
$cloudflaredProcess = Start-Process -FilePath $cloudflared -ArgumentList @(
  "tunnel",
  "--url",
  $originUrl,
  "--no-autoupdate"
) -WindowStyle Hidden -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -PassThru

$publicBase = ""
$tunnelStdoutOffset = 0
$tunnelStderrOffset = 0
$receiverLogOffset = 0
$deadline = (Get-Date).AddSeconds(45)
while (-not $publicBase -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  foreach ($line in (Read-NewLines -Path $tunnelOut -Offset ([ref]$tunnelStdoutOffset)) + (Read-NewLines -Path $tunnelErr -Offset ([ref]$tunnelStderrOffset))) {
    Write-Host $line
    $match = [regex]::Match($line, "https://[A-Za-z0-9.-]+\.trycloudflare\.com")
    if ($match.Success) {
      $publicBase = $match.Value.TrimEnd("/")
    }
  }

  if ($cloudflaredProcess.HasExited) {
    break
  }
}

if (-not $publicBase) {
  Write-Host ""
  Write-Host "Cloudflare tunnel did not produce a public URL."
  Write-Host "Receiver log: $receiverOut"
  Write-Host "Cloudflare logs: $tunnelOut / $tunnelErr"
  if (-not $receiver.HasExited) { Stop-Process -Id $receiver.Id -Force -ErrorAction SilentlyContinue }
  exit 1
}

$publicWebhookUrl = "$publicBase$Route?token=$Token"
Write-Host ""
Write-Host "============================================================"
Write-Host "PUBLIC WEBHOOK URL - paste this into the OTHER PC"
Write-Host $publicWebhookUrl
Write-Host "============================================================"
Write-Host ""
Write-Host "Saving TXT files to: $([System.IO.Path]::GetFullPath($OutputDir))"
Write-Host "Receiver log: $receiverOut"
Write-Host "Cloudflare log: $tunnelErr"
Write-Host "Keep this window open. Press Ctrl+C to stop the tunnel."
Write-Host ""

try {
  while (-not $cloudflaredProcess.HasExited) {
    Start-Sleep -Seconds 1
    foreach ($line in Read-NewLines -Path $receiverOut -Offset ([ref]$receiverLogOffset)) {
      Write-Host $line
    }
    foreach ($line in (Read-NewLines -Path $tunnelOut -Offset ([ref]$tunnelStdoutOffset)) + (Read-NewLines -Path $tunnelErr -Offset ([ref]$tunnelStderrOffset))) {
      Write-Host $line
    }
  }
} finally {
  if ($cloudflaredProcess -and -not $cloudflaredProcess.HasExited) {
    Stop-Process -Id $cloudflaredProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if ($receiver -and -not $receiver.HasExited) {
    Stop-Process -Id $receiver.Id -Force -ErrorAction SilentlyContinue
  }
  Write-PublicLog "Public webhook stopped"
}
