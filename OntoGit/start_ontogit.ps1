[CmdletBinding()]
param(
    [string]$PythonBin = $env:PYTHON_BIN,
    [string]$KnowledgeDataRoot = $env:KNOWLEDGE_DATA_ROOT,
    [string]$StorageRoot = $env:XG_STORAGE_ROOT
)

$ErrorActionPreference = "Stop"

function Resolve-PythonCommand {
    param([AllowNull()][string]$ExplicitPythonBin)

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPythonBin)) {
        return $ExplicitPythonBin
    }

    foreach ($candidate in @("python", "python3", "py")) {
        if (Get-Command $candidate -ErrorAction SilentlyContinue) {
            return $candidate
        }
    }

    return "python"
}

function Set-Utf8ProcessEnvironment {
    $env:PYTHONUTF8 = "1"
    $env:PYTHONIOENCODING = "utf-8"
    $env:LC_ALL = "C.UTF-8"
    $env:LANG = "C.UTF-8"

    try {
        [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    } catch {
        # Python env vars above are enough for child-process output encoding.
    }
}

function Stop-PortListeners {
    param([Parameter(Mandatory)][int]$Port)

    $connections = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if (-not $connections) {
        return
    }

    $ownerPids = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($ownerPid in $ownerPids) {
        if ($ownerPid -and $ownerPid -ne $PID) {
            Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped process on port $Port (PID: $ownerPid)"
        }
    }
}

function Start-OntoGitProcess {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$FilePath,
        [AllowEmptyString()][string]$ArgumentList,
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [Parameter(Mandatory)][string]$StdoutPath,
        [Parameter(Mandatory)][string]$StderrPath
    )

    if (-not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
        throw "$Name working directory not found: $WorkingDirectory"
    }

    if ($FilePath -like "*.exe" -and -not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        throw "$Name executable not found: $FilePath"
    }

    Write-Host "  -> Starting $Name..."
    $startProcessArguments = @{
        FilePath = $FilePath
        WorkingDirectory = $WorkingDirectory
        WindowStyle = "Hidden"
        RedirectStandardOutput = $StdoutPath
        RedirectStandardError = $StderrPath
    }

    if (-not [string]::IsNullOrWhiteSpace($ArgumentList)) {
        $startProcessArguments.ArgumentList = $ArgumentList
    }

    Start-Process @startProcessArguments | Out-Null
}

Set-Utf8ProcessEnvironment
$WorkingDir = Split-Path -Parent $PSCommandPath
$Python = Resolve-PythonCommand -ExplicitPythonBin $PythonBin
$LogDir = Join-Path $WorkingDir ".run-logs"
$RepoRoot = Split-Path -Parent $WorkingDir
$ResolvedKnowledgeDataRoot = if ([string]::IsNullOrWhiteSpace($KnowledgeDataRoot)) {
    Join-Path $RepoRoot "knowledge-data"
} else {
    $KnowledgeDataRoot
}
$SharedStorageRoot = if ([string]::IsNullOrWhiteSpace($StorageRoot)) {
    Join-Path $ResolvedKnowledgeDataRoot "store"
} else {
    $StorageRoot
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $SharedStorageRoot | Out-Null

Write-Host "Stopping old OntoGit processes..."
foreach ($port in @(8000, 5000, 8080)) {
    Stop-PortListeners -Port $port
}

Write-Host "Starting OntoGit service stack from $WorkingDir"
Write-Host "Knowledge data root: $ResolvedKnowledgeDataRoot"
Write-Host "XiaoGuGit storage root: $SharedStorageRoot"

Start-OntoGitProcess `
    -Name "Probability service (port 5000)" `
    -FilePath $Python `
    -ArgumentList "app/main.py" `
    -WorkingDirectory (Join-Path $WorkingDir "probability") `
    -StdoutPath (Join-Path $LogDir "probability.log") `
    -StderrPath (Join-Path $LogDir "probability_err.log")

$env:KNOWLEDGE_DATA_ROOT = $ResolvedKnowledgeDataRoot
$env:XG_STORAGE_ROOT = $SharedStorageRoot

Start-OntoGitProcess `
    -Name "XiaoGuGit service (port 8000)" `
    -FilePath $Python `
    -ArgumentList "server.py" `
    -WorkingDirectory (Join-Path $WorkingDir "xiaogugit") `
    -StdoutPath (Join-Path $LogDir "xiaogugit.log") `
    -StderrPath (Join-Path $LogDir "xiaogugit_err.log")

$env:GATEWAY_SERVICE_API_KEY = "change-me"
$env:GATEWAY_ADDR = ":8080"
$env:GATEWAY_XIAOGUGIT_URL = "http://127.0.0.1:8000"
$env:GATEWAY_PROBABILITY_URL = "http://127.0.0.1:5000"

Start-OntoGitProcess `
    -Name "Gateway service (port 8080)" `
    -FilePath (Join-Path $WorkingDir "gateway\gateway.exe") `
    -ArgumentList "" `
    -WorkingDirectory (Join-Path $WorkingDir "gateway") `
    -StdoutPath (Join-Path $LogDir "gateway.log") `
    -StderrPath (Join-Path $LogDir "gateway_err.log")

Start-Sleep -Seconds 3

Write-Host "============================="
Write-Host "OntoGit service stack started"
Write-Host "============================="
Write-Host "Gateway: http://127.0.0.1:8080"
Write-Host "Dashboard: http://127.0.0.1:8080/ui-dashboard"
Write-Host "XiaoGuGit API: http://127.0.0.1:8000"
Write-Host "Probability API: http://127.0.0.1:5000"
Write-Host ""
Write-Host "Logs:"
Write-Host "  Gateway: Get-Content -Wait '$LogDir\gateway.log'"
Write-Host "  XiaoGuGit: Get-Content -Wait '$LogDir\xiaogugit.log'"
Write-Host "  Probability: Get-Content -Wait '$LogDir\probability.log'"
