param(
  [string]$OutputDir = "$env:USERPROFILE\Documents\GWPC Payloads",
  [int]$Port = 8787,
  [string]$Route = "/gwpc-payload"
)

$ErrorActionPreference = "Stop"

function Write-ReceiverLog {
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

function ConvertTo-SafeFilePart {
  param(
    [string]$Value,
    [string]$Fallback = "unknown"
  )
  $text = ""
  if ($null -ne $Value) {
    $text = $Value.Trim()
  }
  if (-not $text) {
    $text = $Fallback
  }
  $safe = $text -replace '[^A-Za-z0-9._-]+', '_'
  $safe = $safe.Trim("._-")
  if (-not $safe) {
    $safe = $Fallback
  }
  if ($safe.Length -gt 80) {
    $safe = $safe.Substring(0, 80)
  }
  return $safe
}

function Get-JsonValue {
  param(
    [object]$Object,
    [string[]]$Path
  )
  $current = $Object
  foreach ($part in $Path) {
    if ($null -eq $current) {
      return ""
    }
    $property = $current.PSObject.Properties | Where-Object { $_.Name -eq $part } | Select-Object -First 1
    if ($null -eq $property) {
      return ""
    }
    $current = $property.Value
  }
  if ($null -eq $current) {
    return ""
  }
  return [string]$current
}

function Send-JsonResponse {
  param(
    [System.Net.HttpListenerResponse]$Response,
    [int]$StatusCode,
    [object]$Body
  )
  $Response.StatusCode = $StatusCode
  $Response.ContentType = "application/json; charset=utf-8"
  $Response.Headers["Access-Control-Allow-Origin"] = "*"
  $Response.Headers["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
  $Response.Headers["Access-Control-Allow-Headers"] = "Content-Type"
  $json = $Body | ConvertTo-Json -Depth 20
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $Response.ContentLength64 = $bytes.Length
  $Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Response.OutputStream.Close()
}

function Read-RequestBody {
  param([System.Net.HttpListenerRequest]$Request)
  $reader = [System.IO.StreamReader]::new($Request.InputStream, $Request.ContentEncoding)
  try {
    return $reader.ReadToEnd()
  } finally {
    $reader.Close()
  }
}

function Save-PayloadText {
  param(
    [string]$RawBody,
    [object]$ParsedBody,
    [string]$DestinationFolder
  )

  $eventName = Get-JsonValue -Object $ParsedBody -Path @("event")
  $azId = Get-JsonValue -Object $ParsedBody -Path @("currentJob", "AZ ID")
  if (-not $azId) {
    $azId = Get-JsonValue -Object $ParsedBody -Path @("bundle", "AZ ID")
  }
  $submission = Get-JsonValue -Object $ParsedBody -Path @("currentJob", "SubmissionNumber")
  if (-not $submission) {
    $submission = Get-JsonValue -Object $ParsedBody -Path @("bundle", "SubmissionNumber")
  }
  $sentAt = Get-JsonValue -Object $ParsedBody -Path @("sender", "sentAt")
  $script = Get-JsonValue -Object $ParsedBody -Path @("sender", "script")

  $stamp = Get-Date -Format "yyyyMMdd_HHmmss_fff"
  $safeEvent = ConvertTo-SafeFilePart $eventName "payload"
  $safeAz = ConvertTo-SafeFilePart $azId "no-az"
  $safeSubmission = ConvertTo-SafeFilePart $submission "no-submission"
  $fileName = "$stamp`_AZ-$safeAz`_SUB-$safeSubmission`_$safeEvent.txt"
  $path = Join-Path $DestinationFolder $fileName

  $prettyJson = $RawBody
  if ($null -ne $ParsedBody) {
    $prettyJson = $ParsedBody | ConvertTo-Json -Depth 100
  }

  $summary = @(
    "GWPC LOCAL WEBHOOK PAYLOAD",
    "Saved At: $(Get-Date -Format o)",
    "Event: $eventName",
    "AZ ID: $azId",
    "Submission: $submission",
    "Sender: $script",
    "Sender Sent At: $sentAt",
    "",
    "RAW JSON",
    $prettyJson
  ) -join [Environment]::NewLine

  Set-Content -LiteralPath $path -Value $summary -Encoding UTF8
  return $path
}

$Route = Normalize-Route $Route
$resolvedOutputDir = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

$listener = [System.Net.HttpListener]::new()
$prefix = "http://127.0.0.1:$Port/"
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Error "Could not start local webhook at $prefix. If Windows says access is denied, run PowerShell as Administrator once or use a different port. Details: $($_.Exception.Message)"
  exit 1
}

Write-ReceiverLog "Local webhook receiver started"
Write-ReceiverLog "Listening: $prefix"
Write-ReceiverLog "POST URL: http://127.0.0.1:$Port$Route"
Write-ReceiverLog "Saving TXT files to: $resolvedOutputDir"
Write-ReceiverLog "Press Ctrl+C to stop"

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    $requestPath = "/"
    if ($null -ne $request.Url -and $null -ne $request.Url.AbsolutePath) {
      $requestPath = $request.Url.AbsolutePath.TrimEnd("/")
    }
    if (-not $requestPath) {
      $requestPath = "/"
    }

    try {
      if ($request.HttpMethod -eq "OPTIONS") {
        Send-JsonResponse $response 204 @{ ok = $true }
        continue
      }

      if ($request.HttpMethod -eq "GET" -and ($requestPath -eq "/" -or $requestPath -eq "/health")) {
        Send-JsonResponse $response 200 @{
          ok = $true
          service = "gwpc-local-webhook"
          route = $Route
          outputDir = $resolvedOutputDir
        }
        continue
      }

      if ($request.HttpMethod -ne "POST" -or $requestPath -ne $Route) {
        Send-JsonResponse $response 404 @{
          ok = $false
          error = "Use POST http://127.0.0.1:$Port$Route"
        }
        continue
      }

      $raw = Read-RequestBody $request
      if (-not $raw.Trim()) {
        Send-JsonResponse $response 400 @{ ok = $false; error = "Empty request body" }
        continue
      }

      $parsed = $null
      try {
        $parsed = $raw | ConvertFrom-Json
      } catch {
        Write-ReceiverLog "Received non-JSON body; saving raw text"
      }

      $savedPath = Save-PayloadText -RawBody $raw -ParsedBody $parsed -DestinationFolder $resolvedOutputDir
      Write-ReceiverLog "Saved payload: $savedPath"
      Send-JsonResponse $response 200 @{
        ok = $true
        savedPath = $savedPath
      }
    } catch {
      Write-ReceiverLog "Request failed: $($_.Exception.Message)"
      try {
        Send-JsonResponse $response 500 @{
          ok = $false
          error = $_.Exception.Message
        }
      } catch {}
    }
  }
} finally {
  if ($listener.IsListening) {
    $listener.Stop()
  }
  $listener.Close()
  Write-ReceiverLog "Local webhook receiver stopped"
}
