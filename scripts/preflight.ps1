<#
===============================================================================
 MediRoute - pre-demo preflight check
===============================================================================

 Run this before any demo or test session. It wakes the backend, verifies every
 integration is genuinely live rather than silently degraded, and frees the
 ambulance fleet.

   .\scripts\preflight.ps1              # checks production
   .\scripts\preflight.ps1 -Local       # checks localhost:5000
   .\scripts\preflight.ps1 -SkipFleet   # checks only, changes nothing

 Why this exists: several things here fail quietly. A decommissioned AI model
 falls back to keyword rules, a sleeping backend times out a Twilio webhook,
 and an unclosed incident holds an ambulance so dispatch has nothing to send.
 None of those announce themselves. This asks each one directly.
===============================================================================
#>

param(
    [switch]$Local,
    [switch]$SkipFleet
)

$ErrorActionPreference = 'Continue'

$Base = if ($Local) { 'http://localhost:5000' } else { 'https://mediroute-fodu.onrender.com' }
$App  = if ($Local) { 'http://localhost:4173' } else { 'https://mediroute-five.vercel.app' }

$script:Pass = 0
$script:Fail = 0
$script:Warn = 0

function Ok   ($m) { $script:Pass++; Write-Host "  PASS  $m" -ForegroundColor Green }
function Bad  ($m) { $script:Fail++; Write-Host "  FAIL  $m" -ForegroundColor Red }
function Note ($m) { $script:Warn++; Write-Host "  WARN  $m" -ForegroundColor Yellow }
function Info ($m) { Write-Host "  ----  $m" -ForegroundColor DarkGray }


<#
 Windows PowerShell 5.1 throws on any non-2xx response and has no
 -SkipHttpErrorCheck, so the status code is read from the exception. Returns 0
 when the host could not be reached at all.
#>
function Get-Status {
    param([string]$Url, [string]$Method = 'GET', $Body = $null)
    try {
        $p = @{ Uri = $Url; Method = $Method; TimeoutSec = 45; UseBasicParsing = $true }
        if ($Body) { $p.Body = $Body }
        $r = Invoke-WebRequest @p
        return [int]$r.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
}

function Section ($t) {
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host " $t" -ForegroundColor Cyan
    Write-Host "=============================================" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "MediRoute preflight" -ForegroundColor White
Write-Host "Target: $Base" -ForegroundColor DarkGray

# ─────────────────────────────────────────────────────────────────────────────
Section "1. Backend reachable"
# The free tier sleeps after about 15 minutes. A cold start can take most of a
# minute, which is longer than Twilio waits before abandoning a webhook.

$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $health = Invoke-RestMethod -Uri "$Base/health" -TimeoutSec 120
    $sw.Stop()
    $secs = [math]::Round($sw.Elapsed.TotalSeconds, 1)

    if ($health.status -eq 'ok') {
        Ok "backend responding (${secs}s)"
        if ($secs -gt 10) {
            Note "that was a cold start. It is warm now, but it sleeps again after ~15 min idle"
        }
    } else {
        Bad "backend returned an unexpected payload"
    }
} catch {
    Bad "backend unreachable: $($_.Exception.Message)"
    Write-Host ""
    Write-Host "Nothing else can be checked. Start it with: cd server; npm run dev" -ForegroundColor Red
    exit 1
}

# ─────────────────────────────────────────────────────────────────────────────
Section "2. Clinical AI"
# A provider can decommission a model at any time. When that happens triage
# silently falls back to keyword matching, so this asks whether the configured
# model is actually available on the key.

try {
    $ai = Invoke-RestMethod -Uri "$Base/api/ai/health" -TimeoutSec 60
    if ($ai.ok) {
        Ok "AI online, model $($ai.model)"
        Info "speech to text: $($ai.audioModel)"
    } else {
        Bad "AI NOT available: $($ai.message)"
        Note "triage will fall back to the offline protocol and be labelled as such"
    }
} catch {
    Bad "could not reach the AI health endpoint"
}

# ─────────────────────────────────────────────────────────────────────────────
Section "3. Telephony"

try {
    $tel = Invoke-RestMethod -Uri "$Base/api/telephony/health" -TimeoutSec 60

    if ($tel.configured) {
        Ok "Twilio live, sending from $($tel.from)"
        Ok "WhatsApp sender $($tel.whatsappFrom)"
        if ($tel.signatureVerification -eq 'enforced') {
            Ok "webhook signatures enforced"
        } else {
            Note "webhook signatures NOT enforced"
        }
    } else {
        Note "Twilio in simulation mode. Messages are logged, not sent, and report success: false"
        Info "add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to go live"
    }
} catch {
    Bad "telephony routes missing. Is the deployed build current?"
}

# Unsigned webhooks must be refused once credentials are present.
$code = Get-Status -Url "$Base/api/telephony/incoming-sms" -Method POST -Body @{ From = '+910000000000'; Body = 'preflight' }
if ($code -eq 403) {
    Ok "unsigned webhook rejected (403)"
} elseif ($code -eq 200) {
    Note "unsigned webhook accepted. Expected while in simulation mode"
} elseif ($code -eq 0) {
    Info "could not probe the webhook"
} else {
    Note "unsigned webhook returned $code"
}

# ─────────────────────────────────────────────────────────────────────────────
Section "4. Dispatchable fleet"
# An incident holds its ambulance until it is closed, and dispatch only
# considers AVAILABLE units. Abandoned runs therefore shrink the fleet until
# nothing can be sent, with no error anywhere.

try {
    $stats = Invoke-RestMethod -Uri "$Base/api/incidents/stats/summary" -TimeoutSec 60
    $fleet = $stats.summary.fleet

    Info "fleet: $($fleet.available) available, $($fleet.inRoute) in route, $($fleet.total) total"

    if ($fleet.available -ge 2) {
        Ok "enough units free to demo a dispatch"
    } elseif ($fleet.available -eq 1) {
        Note "only ONE unit free. A second report during the demo will not get an ambulance"
    } else {
        Bad "NO units available. A reported emergency will be triaged but never dispatched"
    }

    Info "active incidents: $($stats.summary.active)"
    Info "beds: $($stats.summary.beds.available) of $($stats.summary.beds.total) free"

    if ($null -ne $stats.summary.avgDispatchSeconds) {
        Info "mean dispatch latency: $($stats.summary.avgDispatchSeconds)s over $($stats.summary.avgDispatchSampleSize) dispatches"
    }
} catch {
    Bad "could not read the operational summary"
}

# ─────────────────────────────────────────────────────────────────────────────
Section "5. Public surfaces"

$surfaces = @(
    @{ Name = 'hospitals (public read)'; Url = "$Base/api/hospitals" },
    @{ Name = 'landing page';            Url = "$App/" },
    @{ Name = 'emergency page';          Url = "$App/sos" },
    @{ Name = 'PWA manifest';            Url = "$App/manifest.json" }
)

foreach ($surface in $surfaces) {
    $code = Get-Status -Url $surface.Url
    if ($code -eq 200) { Ok "$($surface.Name)" }
    elseif ($code -eq 0) { Bad "$($surface.Name) unreachable" }
    else { Bad "$($surface.Name) returned $code" }
}

# Writes must stay shut to anonymous callers.
$code = Get-Status -Url "$Base/api/hospitals/seed" -Method POST
if ($code -eq 401) { Ok "destructive seed route requires a session" }
elseif ($code -eq 0) { Info "could not probe the seed route" }
else { Bad "seed route returned $code, expected 401" }

# ─────────────────────────────────────────────────────────────────────────────
if (-not $SkipFleet) {
    Section "6. Releasing abandoned jobs"

    $script = Join-Path $PSScriptRoot "..\server\scripts\close-stale-incidents.cjs"
    if (Test-Path $script) {
        Push-Location (Join-Path $PSScriptRoot "..\server")
        node "scripts\close-stale-incidents.cjs" --apply
        Pop-Location
        Ok "stale incidents closed and their units released"
    } else {
        Note "close-stale-incidents.cjs not found"
    }
}

# ─────────────────────────────────────────────────────────────────────────────
Section "Result"

Write-Host "  $script:Pass passed, $script:Fail failed, $script:Warn warnings" -ForegroundColor White
Write-Host ""

if ($script:Fail -gt 0) {
    Write-Host "Not ready. Fix the failures above before demonstrating." -ForegroundColor Red
    exit 1
} elseif ($script:Warn -gt 0) {
    Write-Host "Usable, but read the warnings. They describe what will look wrong." -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "Ready." -ForegroundColor Green
    exit 0
}
