# Script to stop backend services (Qdrant & Neo4j)
[CmdletBinding()]
param(
    [string]$QdrantVersion = "1.17.1",
    [string]$Neo4jVersion = "5.26.2",
    [int]$TimeoutSeconds = 45
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Use absolute path for dot-sourcing
. (Join-Path $PSScriptRoot "live-backends.common.ps1")

# Get directory layout and load runtime state
$layout = Get-LiveBackendLayout -QdrantVersion $QdrantVersion -Neo4jVersion $Neo4jVersion
$runtimeState = Load-RuntimeState -Layout $layout

# Initialize tracked stop results
$stopped = [ordered]@{
    qdrant = @{
        stopped = $false
        pids = @()
    }
    neo4j = @{
        stopped = $false
        pids = @()
    }
}

# --- Stop Qdrant ---
$qdrantCandidatePids = @()
# Pull PID from runtime state if available
if ($runtimeState -and $runtimeState.qdrant -and $runtimeState.qdrant.pid) {
    $qdrantCandidatePids += [int]$runtimeState.qdrant.pid
}
# Pull PID from listening port
$qdrantCandidatePids += Get-ListeningProcessIds -Ports @($layout.QdrantPort)
$qdrantCandidatePids = @($qdrantCandidatePids | Select-Object -Unique)

foreach ($processId in $qdrantCandidatePids) {
    # Stop process only if verified as owned distribution
    if (Test-QdrantOwnedProcess -ProcessId $processId -Layout $layout) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        $stopped.qdrant.stopped = $true
        $stopped.qdrant.pids += $processId
    }
}

# --- Stop Neo4j ---
$neo4jCandidatePids = @()
# Pull PID from runtime state if available
if ($runtimeState -and $runtimeState.neo4j -and $runtimeState.neo4j.pid) {
    $neo4jCandidatePids += [int]$runtimeState.neo4j.pid
}
# Pull PID from listening port
$neo4jCandidatePids += Get-ListeningProcessIds -Ports @($layout.Neo4jBoltPort, $layout.Neo4jHttpPort)
$neo4jCandidatePids = @($neo4jCandidatePids | Select-Object -Unique)

foreach ($processId in $neo4jCandidatePids) {
    # Stop process only if verified as owned distribution
    if (Test-Neo4jOwnedProcess -ProcessId $processId -Layout $layout) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        $stopped.neo4j.stopped = $true
        $stopped.neo4j.pids += $processId
    }
}

# Wait for ports to clear
if ($stopped.qdrant.stopped) {
    Wait-PortClosed -HostName "localhost" -Port $layout.QdrantPort -TimeoutSeconds $TimeoutSeconds | Out-Null
}

if ($stopped.neo4j.stopped) {
    Wait-PortClosed -HostName "localhost" -Port $layout.Neo4jBoltPort -TimeoutSeconds $TimeoutSeconds | Out-Null
    Wait-PortClosed -HostName "localhost" -Port $layout.Neo4jHttpPort -TimeoutSeconds $TimeoutSeconds | Out-Null
}

# Clear runtime state file after successful stop
Remove-RuntimeState -Layout $layout

# Emit JSON payload summarizing stopped processes
$payload = [pscustomobject]@{
    status = "stopped"
    qdrant = $stopped.qdrant
    neo4j = $stopped.neo4j
} | ConvertTo-Json -Depth 4

Write-Output $payload
