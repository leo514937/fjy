# =============================================================================
# start-all.ps1 -- Unified startup script (DB + Env + API)
#
# Steps:
#   1. Start Qdrant (vector DB)
#   2. Start Neo4j  (graph DB)
#   3. Load .env variables into the current process
#   4. Activate Python venv and launch FastAPI (uvicorn)
#
# Usage:
#   .\scripts\start-all.ps1
#   .\scripts\start-all.ps1 -ApiPort 8080
#   .\scripts\start-all.ps1 -ForceDownload
# =============================================================================

param(
    [string]$QdrantVersion = "1.17.1",
    [string]$QdrantWebUiVersion = "v0.2.8",
    [string]$Neo4jVersion  = "5.26.2",
    [string]$Neo4jPassword = "password",
    [int]$ApiPort          = 8000,
    [int]$TimeoutSeconds   = 120,
    [switch]$ForceDownload
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host ""
Write-Host "  Ontology Audit Hub -- Full Stack Startup" -ForegroundColor Cyan
Write-Host "  Repository: $RepoRoot" -ForegroundColor DarkGray
Write-Host ""

# ── Helper functions ──────────────────────────────────────────────────────────

function Ensure-Dir {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Get-Layout {
    $root = Join-Path $RepoRoot "artifacts\live-backends"
    return [pscustomobject]@{
        Root          = $root
        Downloads     = Join-Path $root "downloads"
        Logs          = Join-Path $root "logs"
        QdrantDir     = Join-Path $root "qdrant"
        QdrantExe     = Join-Path $root "qdrant\qdrant.exe"
        QdrantUrl     = "https://github.com/qdrant/qdrant/releases/download/v$QdrantVersion/qdrant-x86_64-pc-windows-msvc.zip"
        QdrantZip     = Join-Path $root "downloads\qdrant.zip"
        QdrantStaticDir = Join-Path $root "qdrant\static"
        QdrantWebUiUrl  = "https://github.com/qdrant/qdrant-web-ui/releases/download/$QdrantWebUiVersion/dist-qdrant.zip"
        QdrantWebUiZip  = Join-Path $root "downloads\qdrant-web-ui-$QdrantWebUiVersion.zip"
        QdrantPort    = 6333
        Neo4jHome     = Join-Path $root "neo4j\neo4j-community-$Neo4jVersion"
        Neo4jBat      = Join-Path $root "neo4j\neo4j-community-$Neo4jVersion\bin\neo4j.bat"
        Neo4jBoltPort = 7687
        Neo4jHttpPort = 7474
    }
}

function Test-PortOpen {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    return ($null -ne $conn)
}

function Get-PortOwningProcessId {
    param([int]$Port)

    return Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
}

function Test-QdrantOwnedProcess {
    param($Layout, [int]$ProcessId)

    try {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    } catch {
        return $false
    }

    return [string]::Equals($process.ExecutablePath, $Layout.QdrantExe, [System.StringComparison]::OrdinalIgnoreCase)
}

function Start-QdrantProcess {
    param($Layout)

    Start-Process -FilePath $Layout.QdrantExe -WorkingDirectory $Layout.QdrantDir -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

function Test-QdrantDashboardReady {
    param($Layout)

    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$($Layout.QdrantPort)/dashboard" -TimeoutSec 5 -ErrorAction Stop
        return ($response.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Ensure-QdrantWebUiAssets {
    param(
        $Layout,
        [bool]$Refresh = $false
    )

    $indexPath = Join-Path $Layout.QdrantStaticDir "index.html"
    if ((-not $Refresh) -and (Test-Path $indexPath)) {
        return $false
    }

    Write-Host "    Qdrant UI : downloading $QdrantWebUiVersion..." -ForegroundColor Gray
    Invoke-WebRequest -Uri $Layout.QdrantWebUiUrl -OutFile $Layout.QdrantWebUiZip -Headers @{ "User-Agent" = "codex" }

    $extractRoot = Join-Path $Layout.Root "qdrant-web-ui-extract"
    if (Test-Path $extractRoot) {
        Remove-Item -Recurse -Force $extractRoot
    }

    New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
    Expand-Archive -Path $Layout.QdrantWebUiZip -DestinationPath $extractRoot -Force

    $distDir = Join-Path $extractRoot "dist"
    if (-not (Test-Path (Join-Path $distDir "index.html"))) {
        throw "Qdrant Web UI archive did not contain dist/index.html."
    }

    if (Test-Path $Layout.QdrantStaticDir) {
        Remove-Item -Recurse -Force $Layout.QdrantStaticDir
    }

    Move-Item -LiteralPath $distDir -Destination $Layout.QdrantStaticDir
    Remove-Item -Recurse -Force $extractRoot
    Write-Host "    Qdrant UI : OK  http://localhost:$($Layout.QdrantPort)/dashboard" -ForegroundColor Green
    return $true
}

function Invoke-QdrantJson {
    param(
        [int]$Port,
        [string]$Path
    )

    $uri = "http://127.0.0.1:$Port$Path"
    return Invoke-RestMethod -Uri $uri -TimeoutSec 5 -ErrorAction Stop
}

function Show-QdrantSummary {
    param($Layout)

    if (-not (Test-PortOpen -Port $Layout.QdrantPort)) {
        return
    }

    Write-Host ""
    Write-Host "  Qdrant Data Summary" -ForegroundColor Gray

    try {
        $serviceInfo = Invoke-QdrantJson -Port $Layout.QdrantPort -Path "/"
        $collectionsResponse = Invoke-QdrantJson -Port $Layout.QdrantPort -Path "/collections"
    } catch {
        Write-Host "    Qdrant : unable to fetch collection summary from the REST API." -ForegroundColor DarkYellow
        Write-Host "    Detail : $($_.Exception.Message)" -ForegroundColor DarkYellow
        return
    }

    $version = if ($serviceInfo.version) { $serviceInfo.version } else { "unknown" }
    $collections = @($collectionsResponse.result.collections)

    Write-Host "    Version     : $version" -ForegroundColor Green
    Write-Host "    Collections : $($collections.Count)" -ForegroundColor Green

    if ($collections.Count -eq 0) {
        Write-Host "    Data        : no collections found." -ForegroundColor DarkYellow
        Write-Host "    API         : http://127.0.0.1:$($Layout.QdrantPort)/collections" -ForegroundColor DarkGray
        return
    }

    foreach ($collection in $collections) {
        $name = $collection.name

        try {
            $detail = Invoke-QdrantJson -Port $Layout.QdrantPort -Path "/collections/$name"
            $result = $detail.result
            $points = if ($null -ne $result.points_count) { $result.points_count } else { "unknown" }
            $vectors = if ($null -ne $result.indexed_vectors_count) { $result.indexed_vectors_count } else { "unknown" }
            $segments = if ($null -ne $result.segments_count) { $result.segments_count } else { "unknown" }
            $status = if ($result.status) { $result.status } else { "unknown" }

            Write-Host "    - $name" -ForegroundColor Cyan
            Write-Host "      status=$status  points=$points  indexed_vectors=$vectors  segments=$segments" -ForegroundColor DarkGray
        } catch {
            Write-Host "    - $name" -ForegroundColor Cyan
            Write-Host "      unable to fetch collection detail: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
    }

    Write-Host "    API         : http://127.0.0.1:$($Layout.QdrantPort)/collections" -ForegroundColor DarkGray
}

# ── Step 1/4: Databases ───────────────────────────────────────────────────────

Write-Host "[1/4] Checking database services..." -ForegroundColor Yellow
$layout = Get-Layout
Ensure-Dir -Path $layout.Downloads
Ensure-Dir -Path $layout.Logs

# -- Qdrant
if (-not (Test-Path $layout.QdrantExe)) {
    Write-Host "    Qdrant : not found. Downloading from GitHub..." -ForegroundColor DarkYellow
    Invoke-WebRequest -Uri $layout.QdrantUrl -OutFile $layout.QdrantZip
    Expand-Archive -Path $layout.QdrantZip -DestinationPath $layout.QdrantDir -Force
}

if (Test-Path $layout.QdrantExe) {
    $uiChanged = Ensure-QdrantWebUiAssets -Layout $layout -Refresh:$ForceDownload

    if (Test-PortOpen -Port $layout.QdrantPort) {
        Write-Host "    Qdrant : already running on port $($layout.QdrantPort)." -ForegroundColor DarkGreen
        if (-not (Test-QdrantDashboardReady -Layout $layout)) {
            $owningProcessId = Get-PortOwningProcessId -Port $layout.QdrantPort
            if ($owningProcessId -and (Test-QdrantOwnedProcess -Layout $layout -ProcessId $owningProcessId)) {
                Write-Host "    Qdrant : restarting once to load Web UI assets..." -ForegroundColor Gray
                Stop-Process -Id $owningProcessId -Force -ErrorAction Stop
                Start-Sleep -Seconds 1
                Start-QdrantProcess -Layout $layout
                Write-Host "    Qdrant : OK  http://localhost:$($layout.QdrantPort)" -ForegroundColor Green
            } else {
                Write-Host "    Qdrant : dashboard is unavailable and the running process is not owned by this workspace." -ForegroundColor DarkYellow
            }
        }
    } else {
        Write-Host "    Qdrant : starting..." -ForegroundColor Gray
        Start-QdrantProcess -Layout $layout
        Write-Host "    Qdrant : OK  http://localhost:$($layout.QdrantPort)" -ForegroundColor Green
    }
} else {
    Write-Host "    Qdrant : not found. RAG features will be unavailable." -ForegroundColor DarkYellow
}

# -- Neo4j
if (Test-PortOpen -Port $layout.Neo4jBoltPort) {
    Write-Host "    Neo4j  : already running on port $($layout.Neo4jBoltPort). Skipping." -ForegroundColor DarkGreen
} elseif (Test-Path $layout.Neo4jBat) {
    Write-Host "    Neo4j  : starting..." -ForegroundColor Gray
    $env:NEO4J_HOME = $layout.Neo4jHome
    Start-Process -FilePath $layout.Neo4jBat -ArgumentList "console" -WindowStyle Hidden
    Start-Sleep -Seconds 3
    Write-Host "    Neo4j  : OK  bolt://localhost:$($layout.Neo4jBoltPort)" -ForegroundColor Green
} else {
    Write-Host "    Neo4j  : not found. Graph features will be unavailable." -ForegroundColor DarkYellow
}

Show-QdrantSummary -Layout $layout

# -- Open Dashboards in Browser
Write-Host ""
Write-Host "  Opening Database Dashboards..." -ForegroundColor Gray
if (Test-QdrantDashboardReady -Layout $layout) {
    Start-Process "http://localhost:$($layout.QdrantPort)/dashboard"
} else {
    Write-Host "    Qdrant : dashboard is still unavailable. Use the API at http://localhost:$($layout.QdrantPort)/collections" -ForegroundColor DarkYellow
}
Start-Process "http://localhost:$($layout.Neo4jHttpPort)/browser/"

# ── Step 2/4: Load .env ───────────────────────────────────────────────────────

Write-Host "[2/4] Loading .env configuration..." -ForegroundColor Yellow
$EnvFile = Join-Path $RepoRoot ".env"
if (Test-Path $EnvFile) {
    $count = 0
    Get-Content $EnvFile | Where-Object { $_ -match '=' -and $_ -notmatch '^\s*#' } | ForEach-Object {
        $parts = $_ -split '=', 2
        $k = $parts[0].Trim()
        $v = $parts[1].Trim()
        if ($k) {
            [System.Environment]::SetEnvironmentVariable($k, $v)
            $count++
        }
    }
    Write-Host "    OK: $count variables loaded." -ForegroundColor Green

    $llmEnabled = [System.Environment]::GetEnvironmentVariable("ONTOLOGY_AUDIT_LLM_ENABLED")
    $llmModel   = [System.Environment]::GetEnvironmentVariable("ONTOLOGY_AUDIT_LLM_MODEL")
    $apiKey     = [System.Environment]::GetEnvironmentVariable("OPENAI_API_KEY")
    $qdrantUrl  = [System.Environment]::GetEnvironmentVariable("ONTOLOGY_AUDIT_QDRANT_URL")

    Write-Host "    LLM     : $(if ($llmEnabled -eq 'true') { 'ENABLED' } else { 'DISABLED -- set ONTOLOGY_AUDIT_LLM_ENABLED=true' })" -ForegroundColor $(if ($llmEnabled -eq 'true') { 'Green' } else { 'Red' })
    Write-Host "    Model   : $(if ($llmModel) { $llmModel } else { '(not set)' })" -ForegroundColor $(if ($llmModel) { 'Green' } else { 'DarkYellow' })
    Write-Host "    API Key : $(if ($apiKey) { $apiKey.Substring(0, [Math]::Min(16, $apiKey.Length)) + '...' } else { '(not set)' })" -ForegroundColor $(if ($apiKey) { 'Green' } else { 'Red' })
    Write-Host "    Qdrant  : $(if ($qdrantUrl) { $qdrantUrl } else { '(not set)' })" -ForegroundColor $(if ($qdrantUrl) { 'Green' } else { 'DarkYellow' })
} else {
    Write-Host "    WARNING: .env not found. Copy .env.example and fill in your keys." -ForegroundColor Red
}

# ── Step 3/4: Python venv ─────────────────────────────────────────────────────

Write-Host "[3/4] Checking Python virtual environment..." -ForegroundColor Yellow
$VenvActivate = Join-Path $RepoRoot ".venv\Scripts\Activate.ps1"
if (Test-Path $VenvActivate) {
    & $VenvActivate
    Write-Host "    OK: Virtual environment activated." -ForegroundColor Green
} else {
    Write-Host "    INFO: No .venv found. Using system Python." -ForegroundColor DarkGray
}

# ── Step 4/4: Start API ───────────────────────────────────────────────────────

Write-Host "[4/4] Starting FastAPI server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  API  : http://127.0.0.1:$ApiPort" -ForegroundColor Cyan
Write-Host "  Docs : http://127.0.0.1:$ApiPort/docs" -ForegroundColor Cyan
Write-Host "  QA   : http://127.0.0.1:$ApiPort/qa/answer  [POST]" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

python -m uvicorn ontology_audit_hub.api:app --host 127.0.0.1 --port $ApiPort --reload
