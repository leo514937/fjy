[CmdletBinding()]
param(
  [ValidateSet('RunStack', 'RunBackend', 'RunFrontend')]
  [string]$Mode = 'RunStack',
  [string]$LogFile,
  [string]$Port = $env:PORT,
  [string]$VitePort = $env:VITE_PORT,
  [string]$PythonBin = $env:PYTHON_BIN,
  [string]$WIKIMG_ROOT = $env:WIKIMG_ROOT,
  [string]$KnowledgeDataRoot = $env:KNOWLEDGE_DATA_ROOT,
  [string]$WIKIMG_PROFILE = $env:WIKIMG_PROFILE,
  [string]$SharedStorageRoot = $env:ONTOGIT_STORAGE_ROOT,
  [string]$KNOWLEDGE_BASE_PROVIDER = $env:KNOWLEDGE_BASE_PROVIDER,
  [switch]$SkipInstall,
  [switch]$SkipOntoGit = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-ScriptPath {
  $candidate = $PSCommandPath
  if ([string]::IsNullOrWhiteSpace($candidate) -and -not [string]::IsNullOrWhiteSpace($MyInvocation.MyCommand.Path)) {
    $candidate = $MyInvocation.MyCommand.Path
  }
  if ([string]::IsNullOrWhiteSpace($candidate)) {
    $candidate = Join-Path (Get-Location).Path 'start_kimi_stack.ps1'
  }
  return $candidate
}

function Resolve-PythonCommand {
  param([AllowNull()][string]$ExplicitPythonBin)

  if (-not [string]::IsNullOrWhiteSpace($ExplicitPythonBin)) {
    return $ExplicitPythonBin
  }
  foreach ($candidate in @('python', 'python3', 'py')) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
      return $candidate
    }
  }
  return 'python'
}

function Set-Utf8ProcessEnvironment {
  $env:PYTHONUTF8 = '1'
  $env:PYTHONIOENCODING = 'utf-8'
  $env:LC_ALL = 'C.UTF-8'
  $env:LANG = 'C.UTF-8'

  try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
  } catch {
    # Some hosts do not allow console encoding changes; Python env vars above are the important part.
  }
}

function Get-PowerShellExecutablePath {
  $process = Get-Process -Id $PID -ErrorAction SilentlyContinue
  if ($process -and -not [string]::IsNullOrWhiteSpace($process.Path)) {
    return $process.Path
  }
  return 'powershell.exe'
}

function Get-Config {
  $scriptPath = Resolve-ScriptPath
  $rootDir = Split-Path -Parent $scriptPath
  $backendPort = if ([string]::IsNullOrWhiteSpace($Port)) { 8787 } else { [int]$Port }
  $frontendPort = if ([string]::IsNullOrWhiteSpace($VitePort)) { 5173 } else { [int]$VitePort }
  $wikiMgRoot = if ([string]::IsNullOrWhiteSpace($WIKIMG_ROOT)) {
    Join-Path $rootDir 'Ontology_Factory'
  } else {
    $WIKIMG_ROOT
  }
  $knowledgeDataRoot = if ([string]::IsNullOrWhiteSpace($KnowledgeDataRoot)) {
    Join-Path $rootDir 'knowledge-data'
  } else {
    $KnowledgeDataRoot
  }
  $sharedStorageRoot = if ([string]::IsNullOrWhiteSpace($SharedStorageRoot)) {
    Join-Path $knowledgeDataRoot 'store'
  } else {
    $SharedStorageRoot
  }

  [pscustomobject]@{
    RootDir = $rootDir
    ScriptPath = $scriptPath
    PowerShellExecutable = Get-PowerShellExecutablePath
    AppDir = Join-Path $rootDir 'kimi-agent-knowledge-base-collab\app'
    QAgentDir = Join-Path $rootDir 'QAgent'
    WebRuntimeDir = Join-Path $rootDir 'kimi-agent-knowledge-base-collab\.qagent-web-runtime'
    LogDir = Join-Path $rootDir '.run-logs'
    BackendLogFile = Join-Path $rootDir '.run-logs\kimi-backend.log'
    FrontendLogFile = Join-Path $rootDir '.run-logs\kimi-frontend.log'
    BackendPidFile = Join-Path $rootDir '.run-logs\kimi-backend.pid'
    FrontendPidFile = Join-Path $rootDir '.run-logs\kimi-frontend.pid'
    BackendPort = $backendPort
    FrontendPort = $frontendPort
    PythonBin = Resolve-PythonCommand -ExplicitPythonBin $PythonBin
    WikiMgRoot = $wikiMgRoot
    KnowledgeDataRoot = $knowledgeDataRoot
    SharedStorageRoot = $sharedStorageRoot
    WikiMgProfile = if ([string]::IsNullOrWhiteSpace($WIKIMG_PROFILE)) { 'kimi' } else { $WIKIMG_PROFILE }
    KnowledgeBaseProvider = if ([string]::IsNullOrWhiteSpace($KNOWLEDGE_BASE_PROVIDER)) { 'wikimg' } else { $KNOWLEDGE_BASE_PROVIDER }
    WikiMgCliPath = Join-Path $wikiMgRoot 'WIKI_MG\wikimg'
  }
}

function Assert-Command {
  param([Parameter(Mandatory)][string]$CommandName)

  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $CommandName"
  }
}

function Install-NpmDependenciesIfNeeded {
  param(
    [Parameter(Mandatory)][string]$Directory,
    [Parameter(Mandatory)][string]$Name
  )

  if (Test-Path -LiteralPath (Join-Path $Directory 'node_modules') -PathType Container) {
    return
  }
  if ($SkipInstall) {
    throw "Missing node_modules for $Name. Run npm ci in $Directory or rerun without -SkipInstall."
  }

  Write-Host "Installing npm dependencies for $Name..."
  Push-Location $Directory
  try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) {
      throw "npm ci failed in $Directory"
    }
  } finally {
    Pop-Location
  }
}

function Assert-Prerequisites {
  param([Parameter(Mandatory)][psobject]$Config)

  Assert-Command -CommandName 'node'
  Assert-Command -CommandName 'npm'
  Assert-Command -CommandName $Config.PythonBin

  foreach ($dir in @($Config.AppDir, $Config.QAgentDir, $Config.WikiMgRoot)) {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
      throw "Required directory not found: $dir"
    }
  }
  if (-not (Test-Path -LiteralPath $Config.WikiMgCliPath -PathType Leaf)) {
    throw "WiKiMG CLI not found: $($Config.WikiMgCliPath)"
  }

  Install-NpmDependenciesIfNeeded -Directory $Config.QAgentDir -Name 'QAgent'
  Install-NpmDependenciesIfNeeded -Directory $Config.AppDir -Name 'Kimi app'
}

function Get-PortOwnerPids {
  param([Parameter(Mandatory)][int]$Port)

  $connections = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if (-not $connections) {
    return @()
  }
  return @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Stop-PidFileProcess {
  param([Parameter(Mandatory)][string]$PidFile)

  if (-not (Test-Path -LiteralPath $PidFile -PathType Leaf)) {
    return
  }

  $rawPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  $processId = 0
  if ([int]::TryParse([string]$rawPid, [ref]$processId) -and $processId -gt 0 -and $processId -ne $PID) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Stop-PortListeners {
  param([Parameter(Mandatory)][int]$Port)

  $pids = @(Get-PortOwnerPids -Port $Port)
  if ($pids.Count -eq 0) {
    return
  }

  Write-Host "Stopping processes using port $($Port): $($pids -join ', ')"
  foreach ($pidValue in $pids) {
    if ($pidValue -and $pidValue -ne $PID) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 1
}

function Wait-ForHttpReady {
  param(
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][string]$Name,
    [int]$Retries = 60
  )

  for ($index = 0; $index -lt $Retries; $index += 1) {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
      Write-Host "$Name is ready: $Url"
      return
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  throw "$Name startup timed out: $Url"
}

function Wait-ForPortReady {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$Name,
    [int]$Retries = 60
  )

  for ($index = 0; $index -lt $Retries; $index += 1) {
    if (@(Get-PortOwnerPids -Port $Port).Count -gt 0) {
      Write-Host "$Name is listening on port $Port"
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "$Name startup timed out; port not listening: $Port"
}

function Initialize-LogFile {
  param([Parameter(Mandatory)][string]$Path)

  $directory = Split-Path -Parent $Path
  if (-not [string]::IsNullOrWhiteSpace($directory)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }
  Set-Content -LiteralPath $Path -Value '' -Encoding UTF8
}

function Write-LogBanner {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string[]]$Lines
  )

  $content = @(
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')]"
    $Lines
    ''
  ) -join [Environment]::NewLine
  Add-Content -LiteralPath $Path -Value $content -Encoding UTF8
}

function Get-ChildArgs {
  param(
    [Parameter(Mandatory)][psobject]$Config,
    [Parameter(Mandatory)][ValidateSet('RunBackend', 'RunFrontend')][string]$ChildMode,
    [Parameter(Mandatory)][string]$CurrentLogFile
  )

  $args = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $Config.ScriptPath,
    '-Mode', $ChildMode,
    '-Port', [string]$Config.BackendPort,
    '-VitePort', [string]$Config.FrontendPort,
    '-PythonBin', $Config.PythonBin,
    '-WIKIMG_ROOT', $Config.WikiMgRoot,
    '-KnowledgeDataRoot', $Config.KnowledgeDataRoot,
    '-WIKIMG_PROFILE', $Config.WikiMgProfile,
    '-SharedStorageRoot', $Config.SharedStorageRoot,
    '-KNOWLEDGE_BASE_PROVIDER', $Config.KnowledgeBaseProvider,
    '-LogFile', $CurrentLogFile
  )
  if ($SkipInstall) {
    $args += '-SkipInstall'
  }
  if ($SkipOntoGit) {
    $args += '-SkipOntoGit'
  }
  return $args
}

function Start-DetachedProcess {
  param(
    [Parameter(Mandatory)][psobject]$Config,
    [Parameter(Mandatory)][ValidateSet('RunBackend', 'RunFrontend')][string]$ChildMode,
    [Parameter(Mandatory)][string]$CurrentLogFile,
    [Parameter(Mandatory)][string]$PidFile
  )

  Initialize-LogFile -Path $CurrentLogFile
  $arguments = Get-ChildArgs -Config $Config -ChildMode $ChildMode -CurrentLogFile $CurrentLogFile
  $process = Start-Process -FilePath $Config.PowerShellExecutable -ArgumentList $arguments -WorkingDirectory $Config.RootDir -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ASCII
  return $process
}

function Stop-QAgentGateway {
  param([Parameter(Mandatory)][psobject]$Config)

  if (-not (Test-Path -LiteralPath $Config.QAgentDir -PathType Container)) {
    return
  }

  Write-Host 'Stopping old QAgent web runtime gateway...'
  Push-Location $Config.QAgentDir
  try {
    & node '.\bin\qagent.js' --cwd $Config.WebRuntimeDir gateway stop *> $null
  } catch {
  } finally {
    Pop-Location
  }
}

function Invoke-LoggedCommand {
  param(
    [Parameter(Mandatory)][string]$LogPath,
    [Parameter(Mandatory)][scriptblock]$Command
  )

  & $Command 2>&1 | ForEach-Object {
    Add-Content -LiteralPath $LogPath -Value ([string]$_) -Encoding UTF8
  }
  $exitCode = if (Test-Path Variable:\LASTEXITCODE) { $LASTEXITCODE } else { 0 }
  if ($exitCode -ne 0) {
    exit $exitCode
  }
}

function Invoke-BackendProcess {
  param(
    [Parameter(Mandatory)][psobject]$Config,
    [Parameter(Mandatory)][string]$CurrentLogFile
  )

  Push-Location $Config.AppDir
  try {
    $env:KNOWLEDGE_BASE_PROVIDER = $Config.KnowledgeBaseProvider
    $env:WIKIMG_ROOT = $Config.WikiMgRoot
    $env:KNOWLEDGE_DATA_ROOT = $Config.KnowledgeDataRoot
    $env:WIKIMG_PROFILE = $Config.WikiMgProfile
    $env:ONTOGIT_STORAGE_ROOT = $Config.SharedStorageRoot
    $env:WIKIMG_ONTOGIT_STORAGE_ROOT = $Config.SharedStorageRoot
    $env:PYTHON_BIN = $Config.PythonBin
    $env:PORT = [string]$Config.BackendPort
    Write-LogBanner -Path $CurrentLogFile -Lines @('Starting Kimi backend', "APP_DIR: $($Config.AppDir)", "PORT: $($Config.BackendPort)")
    Invoke-LoggedCommand -LogPath $CurrentLogFile -Command { & node '.\server.mjs' }
  } finally {
    Pop-Location
  }
}

function Invoke-FrontendProcess {
  param(
    [Parameter(Mandatory)][psobject]$Config,
    [Parameter(Mandatory)][string]$CurrentLogFile
  )

  Push-Location $Config.AppDir
  try {
    Write-LogBanner -Path $CurrentLogFile -Lines @('Starting Vite frontend', "APP_DIR: $($Config.AppDir)", "PORT: $($Config.FrontendPort)")
    Invoke-LoggedCommand -LogPath $CurrentLogFile -Command { & npm.cmd run dev -- --host 0.0.0.0 --port ([string]$Config.FrontendPort) }
  } finally {
    Pop-Location
  }
}

function Show-Summary {
  param([Parameter(Mandatory)][psobject]$Config)

  @(
    '',
    'Startup complete',
    "  Frontend: http://localhost:$($Config.FrontendPort)",
    "  Backend health: http://localhost:$($Config.BackendPort)/api/health",
    "  Knowledge data root: $($Config.KnowledgeDataRoot)",
    "  Shared storage: $($Config.SharedStorageRoot)",
    '',
    'Logs',
    "  Frontend: $($Config.FrontendLogFile)",
    "  Backend: $($Config.BackendLogFile)",
  ) | ForEach-Object { Write-Host $_ }
}

function Start-KimiStack {
  param([Parameter(Mandatory)][psobject]$Config)

  New-Item -ItemType Directory -Force -Path $Config.LogDir | Out-Null
  Assert-Prerequisites -Config $Config
  Write-Host 'Stopping old processes...'
  Stop-PidFileProcess -PidFile $Config.BackendPidFile
  Stop-PidFileProcess -PidFile $Config.FrontendPidFile
  Stop-QAgentGateway -Config $Config
  Stop-PortListeners -Port $Config.BackendPort
  Stop-PortListeners -Port $Config.FrontendPort
  Write-Host 'Starting backend...'
  Start-DetachedProcess -Config $Config -ChildMode 'RunBackend' -CurrentLogFile $Config.BackendLogFile -PidFile $Config.BackendPidFile | Out-Null
  Wait-ForHttpReady -Url "http://localhost:$($Config.BackendPort)/api/health" -Name 'Backend'
  Write-Host 'Starting frontend...'
  Start-DetachedProcess -Config $Config -ChildMode 'RunFrontend' -CurrentLogFile $Config.FrontendLogFile -PidFile $Config.FrontendPidFile | Out-Null
  Wait-ForPortReady -Port $Config.FrontendPort -Name 'Frontend'
  Show-Summary -Config $Config
}

function Invoke-ByMode {
  Set-Utf8ProcessEnvironment
  $config = Get-Config
  switch ($Mode) {
    'RunStack' { Start-KimiStack -Config $config; break }
    'RunBackend' {
      $effectiveLogFile = if ([string]::IsNullOrWhiteSpace($LogFile)) { $config.BackendLogFile } else { $LogFile }
      Invoke-BackendProcess -Config $config -CurrentLogFile $effectiveLogFile
      break
    }
    'RunFrontend' {
      $effectiveLogFile = if ([string]::IsNullOrWhiteSpace($LogFile)) { $config.FrontendLogFile } else { $LogFile }
      Invoke-FrontendProcess -Config $config -CurrentLogFile $effectiveLogFile
      break
    }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  Invoke-ByMode
}
