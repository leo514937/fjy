[CmdletBinding()]
param(
  [ValidateSet('RunStack', 'RunBackend', 'RunFrontend', 'RunGateway', 'RunXiaogugit', 'RunProbability')]
  [string]$Mode = 'RunStack',
  [string]$LogFile,
  [string]$Port,
  [string]$VitePort,
  [string]$PythonBin = $env:PYTHON_BIN,
  [string]$WIKIMG_ROOT = $env:WIKIMG_ROOT,
  [string]$KnowledgeDataRoot = $env:KNOWLEDGE_DATA_ROOT,
  [string]$WIKIMG_PROFILE = $env:WIKIMG_PROFILE,
  [string]$SharedStorageRoot = $env:ONTOGIT_STORAGE_ROOT,
  [string]$ONTOGIT_GATEWAY_URL = $env:ONTOGIT_GATEWAY_URL,
  [string]$GATEWAY_SERVICE_API_KEY = $env:GATEWAY_SERVICE_API_KEY,
  [string]$GATEWAY_XG_AUTH_SECRET = $env:GATEWAY_XG_AUTH_SECRET,
  [string]$GATEWAY_XG_AUTH_USERNAME = $env:GATEWAY_XG_AUTH_USERNAME,
  [string]$XG_AUTH_SECRET = $env:XG_AUTH_SECRET,
  [string]$XG_AUTH_USERNAME = $env:XG_AUTH_USERNAME,
  [string]$XG_AUTH_PASSWORD = $env:XG_AUTH_PASSWORD,
  [string]$OPENROUTER_API_KEY = $env:OPENROUTER_API_KEY,
  [string]$OPENROUTER_BASE_URL = $env:OPENROUTER_BASE_URL,
  [string]$OPENROUTER_MODEL = $env:OPENROUTER_MODEL,
  [string]$DMXAPI_API_KEY = $env:DMXAPI_API_KEY,
  [string]$DMXAPI_BASE_URL = $env:DMXAPI_BASE_URL,
  [string]$DMXAPI_MODEL = $env:DMXAPI_MODEL,
  [switch]$SkipInstall,
  [switch]$SkipOntoGit
)

# Set-StrictMode -Version Latest
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
  $xiaoGuGitDir = Join-Path $rootDir 'OntoGit\xiaogugit'
  $probabilityDir = Join-Path $rootDir 'OntoGit\probability'
  $gatewayDir = Join-Path $rootDir 'OntoGit\gateway'
  $hasLocalOntoGitLayout = (
    (Test-Path -LiteralPath $xiaoGuGitDir -PathType Container) -and
    (Test-Path -LiteralPath $probabilityDir -PathType Container) -and
    (Test-Path -LiteralPath $gatewayDir -PathType Container)
  )
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
    XiaoGuGitDir = $xiaoGuGitDir
    ProbabilityDir = $probabilityDir
    GatewayDir = $gatewayDir
    LogDir = Join-Path $rootDir '.run-logs'
    BackendLogFile = Join-Path $rootDir '.run-logs\kimi-backend.log'
    FrontendLogFile = Join-Path $rootDir '.run-logs\kimi-frontend.log'
    XiaoGuGitLogFile = Join-Path $rootDir '.run-logs\xiaogugit.log'
    ProbabilityLogFile = Join-Path $rootDir '.run-logs\probability.log'
    GatewayLogFile = Join-Path $rootDir '.run-logs\ontogit-gateway.log'
    XiaoGuGitErrorLogFile = Join-Path $rootDir '.run-logs\xiaogugit.err.log'
    ProbabilityErrorLogFile = Join-Path $rootDir '.run-logs\probability.err.log'
    GatewayErrorLogFile = Join-Path $rootDir '.run-logs\ontogit-gateway.err.log'
    BackendPidFile = Join-Path $rootDir '.run-logs\kimi-backend.pid'
    FrontendPidFile = Join-Path $rootDir '.run-logs\kimi-frontend.pid'
    XiaoGuGitPidFile = Join-Path $rootDir '.run-logs\xiaogugit.pid'
    ProbabilityPidFile = Join-Path $rootDir '.run-logs\probability.pid'
    GatewayPidFile = Join-Path $rootDir '.run-logs\ontogit-gateway.pid'
    BackendPort = $backendPort
    FrontendPort = $frontendPort
    XiaoGuGitPort = 8001
    ProbabilityPort = 5001
    GatewayPort = 8080
    OntoGitGatewayUrl = if ([string]::IsNullOrWhiteSpace($ONTOGIT_GATEWAY_URL)) { 'http://81.70.12.214:8080' } else { $ONTOGIT_GATEWAY_URL }
    HasLocalOntoGitLayout = $hasLocalOntoGitLayout
    UseRemoteOntoGit = ($SkipOntoGit -or -not $hasLocalOntoGitLayout)
    PythonBin = Resolve-PythonCommand -ExplicitPythonBin $PythonBin
    WikiMgRoot = $wikiMgRoot
    KnowledgeDataRoot = $knowledgeDataRoot
    SharedStorageRoot = $sharedStorageRoot
    WikiMgProfile = if ([string]::IsNullOrWhiteSpace($WIKIMG_PROFILE)) { 'kimi' } else { $WIKIMG_PROFILE }
    WikiMgCliPath = Join-Path $wikiMgRoot 'WIKI_MG\wikimg'
    GatewayServiceAPIKey = if ([string]::IsNullOrWhiteSpace($GATEWAY_SERVICE_API_KEY)) { "xgk_79689a3af4225035d2de7551ff1b2b69070636b2fbb12205" } else { $GATEWAY_SERVICE_API_KEY }
    AuthSecret = if ([string]::IsNullOrWhiteSpace($XG_AUTH_SECRET)) { 'xiaogugit-auth-secret' } else { $XG_AUTH_SECRET }
    AuthUsername = if ([string]::IsNullOrWhiteSpace($XG_AUTH_USERNAME)) { 'mogong' } else { $XG_AUTH_USERNAME }
    AuthPassword = if ([string]::IsNullOrWhiteSpace($XG_AUTH_PASSWORD)) { '123456' } else { $XG_AUTH_PASSWORD }
    GatewayXGAuthSecret = if ([string]::IsNullOrWhiteSpace($GATEWAY_XG_AUTH_SECRET)) {
      if ([string]::IsNullOrWhiteSpace($XG_AUTH_SECRET)) { 'xiaogugit-auth-secret' } else { $XG_AUTH_SECRET }
    } else {
      $GATEWAY_XG_AUTH_SECRET
    }
    GatewayXGAuthUsername = if ([string]::IsNullOrWhiteSpace($GATEWAY_XG_AUTH_USERNAME)) {
      if ([string]::IsNullOrWhiteSpace($XG_AUTH_USERNAME)) { 'mogong' } else { $XG_AUTH_USERNAME }
    } else {
      $GATEWAY_XG_AUTH_USERNAME
    }
    DMXAPIKey = if ([string]::IsNullOrWhiteSpace($DMXAPI_API_KEY)) { $OPENROUTER_API_KEY } else { $DMXAPI_API_KEY }
    DMXAPIBaseUrl = if ([string]::IsNullOrWhiteSpace($DMXAPI_BASE_URL)) { if ([string]::IsNullOrWhiteSpace($OPENROUTER_BASE_URL)) { 'https://openrouter.ai/api/v1' } else { $OPENROUTER_BASE_URL } } else { $DMXAPI_BASE_URL }
    DMXAPIModel = if ([string]::IsNullOrWhiteSpace($DMXAPI_MODEL)) { if ([string]::IsNullOrWhiteSpace($OPENROUTER_MODEL)) { 'openai/gpt-4o-mini' } else { $OPENROUTER_MODEL } } else { $DMXAPI_MODEL }
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
  if (-not $Config.UseRemoteOntoGit) {
    Assert-Command -CommandName $Config.PythonBin
  }

  $requiredDirs = @($Config.AppDir)
  if (-not $Config.UseRemoteOntoGit) {
    $requiredDirs += @($Config.XiaoGuGitDir, $Config.ProbabilityDir, $Config.GatewayDir, $Config.WikiMgRoot)
  }

  foreach ($dir in $requiredDirs) {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
      throw "Required directory not found: $dir"
    }
  }
  if (-not $Config.UseRemoteOntoGit -and -not (Test-Path -LiteralPath $Config.WikiMgCliPath -PathType Leaf)) {
    throw "WiKiMG CLI not found: $($Config.WikiMgCliPath)"
  }

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
    Stop-ProcessTreeById -ProcessId $processId
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
      Stop-ProcessTreeById -ProcessId $pidValue
    }
  }
  Start-Sleep -Seconds 1
}

function Stop-ProcessTreeById {
  param([Parameter(Mandatory)][int]$ProcessId)

  if ($ProcessId -le 0 -or $ProcessId -eq $PID) {
    return
  }

  try {
    $taskkill = Start-Process `
      -FilePath 'cmd.exe' `
      -ArgumentList @('/c', "taskkill /PID $ProcessId /T /F >nul 2>&1") `
      -Wait `
      -PassThru `
      -WindowStyle Hidden
    if ($taskkill.ExitCode -ne 0) {
      Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
  } catch {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Get-OntoGitGatewayLaunchMode {
  param([Parameter(Mandatory)][psobject]$Config)

  $gatewayExe = Join-Path $Config.GatewayDir 'gateway.exe'
  if (Test-Path -LiteralPath $gatewayExe -PathType Leaf) {
    return 'gateway.exe'
  }

  $goCandidates = @(
    (Get-Command go -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    'D:\Go\go1.24.8\bin\go.exe',
    'D:\Go\go\bin\go.exe'
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

  foreach ($candidate in $goCandidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return $candidate
    }
  }

  if (Get-Command docker -ErrorAction SilentlyContinue) {
    return 'docker'
  }

  return $null
}

function Wait-ForHttpReady {
  param(
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][string]$Name,
    [int]$Retries = 60
  )

  Write-Host "Waiting for $Name to be ready at $Url..."
  for ($index = 0; $index -lt $Retries; $index += 1) {
    try {
      # Use a slightly longer timeout and 127.0.0.1 to avoid IPv6/localhost issues on Windows
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 | Out-Null
      Write-Host "$Name is ready: $Url"
      return
    } catch {
      if ($index % 5 -eq 0 -and $index -gt 0) {
        Write-Host "  ... still waiting for $Name ($index/$Retries)"
      }
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
  for ($attempt = 0; $attempt -lt 10; $attempt += 1) {
    try {
      Set-Content -LiteralPath $Path -Value '' -Encoding UTF8
      return
    } catch {
      if ($attempt -eq 9) {
        throw
      }
      Start-Sleep -Milliseconds 200
    }
  }
}

function Start-PythonServiceProcess {
  param(
    [Parameter(Mandatory)][psobject]$Config,
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$WorkingDirectory,
    [Parameter(Mandatory)][string]$ScriptPath,
    [Parameter(Mandatory)][string]$StdOutLogFile,
    [Parameter(Mandatory)][string]$StdErrLogFile,
    [Parameter(Mandatory)][string]$PidFile,
    [Parameter(Mandatory)][hashtable]$EnvironmentOverrides
  )

  Initialize-LogFile -Path $StdOutLogFile
  Initialize-LogFile -Path $StdErrLogFile
  $savedEnv = @{}
  foreach ($key in $EnvironmentOverrides.Keys) {
    $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, [string]$EnvironmentOverrides[$key], 'Process')
  }
  
  try {
    Write-LogBanner -Path $StdOutLogFile -Lines @("Starting OntoGit $Name", "DIR: $WorkingDirectory", "SCRIPT: $ScriptPath")
    $process = Start-Process `
      -FilePath $Config.PythonBin `
      -ArgumentList @($ScriptPath) `
      -WorkingDirectory $WorkingDirectory `
      -RedirectStandardOutput $StdOutLogFile `
      -RedirectStandardError $StdErrLogFile `
      -WindowStyle Hidden `
      -PassThru

    Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ASCII
    return $process
  } finally {
    foreach ($key in $savedEnv.Keys) {
      [Environment]::SetEnvironmentVariable($key, $savedEnv[$key], 'Process')
    }
  }
}

function Start-NativeServiceProcess {
  param(
    [Parameter(Mandatory)][psobject]$Config,
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$WorkingDirectory,
    [Parameter(Mandatory)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [Parameter(Mandatory)][string]$StdOutLogFile,
    [Parameter(Mandatory)][string]$StdErrLogFile,
    [Parameter(Mandatory)][string]$PidFile
  )

  Initialize-LogFile -Path $StdOutLogFile
  Initialize-LogFile -Path $StdErrLogFile
  Write-LogBanner -Path $StdOutLogFile -Lines @(
    "Starting OntoGit $Name",
    "DIR: $WorkingDirectory",
    "FILE: $FilePath",
    "ARGS: $($ArgumentList -join ' ')"
  )

  $startParams = @{
    FilePath = $FilePath
    WorkingDirectory = $WorkingDirectory
    RedirectStandardOutput = $StdOutLogFile
    RedirectStandardError = $StdErrLogFile
    WindowStyle = 'Hidden'
    PassThru = $true
  }
  if ($null -ne $ArgumentList -and @($ArgumentList).Count -gt 0) {
    $startParams.ArgumentList = $ArgumentList
  }

  $process = Start-Process @startParams

  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ASCII
  return $process
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
    [Parameter(Mandatory)][ValidateSet('RunBackend', 'RunFrontend', 'RunGateway', 'RunXiaogugit', 'RunProbability')][string]$ChildMode,
    [Parameter(Mandatory)][string]$CurrentLogFile,
    [switch]$SkipInstall,
    [switch]$SkipOntoGit
  )

  $childArgs = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', "$($Config.ScriptPath)",
    '-Mode', $ChildMode,
    '-Port', [string]$Config.BackendPort,
    '-VitePort', [string]$Config.FrontendPort,
    '-PythonBin', $Config.PythonBin,
    '-WIKIMG_ROOT', $Config.WikiMgRoot,
    '-KnowledgeDataRoot', $Config.KnowledgeDataRoot,
    '-WIKIMG_PROFILE', $Config.WikiMgProfile,
    '-SharedStorageRoot', $Config.SharedStorageRoot,
    '-ONTOGIT_GATEWAY_URL', $Config.OntoGitGatewayUrl,
    '-GATEWAY_SERVICE_API_KEY', $Config.GatewayServiceAPIKey,
    '-GATEWAY_XG_AUTH_SECRET', $Config.GatewayXGAuthSecret,
    '-GATEWAY_XG_AUTH_USERNAME', $Config.GatewayXGAuthUsername,
    '-XG_AUTH_SECRET', $Config.AuthSecret,
    '-XG_AUTH_USERNAME', $Config.AuthUsername,
    '-XG_AUTH_PASSWORD', $Config.AuthPassword,
    '-DMXAPI_API_KEY', "$($Config.DMXAPIKey)",
    '-DMXAPI_BASE_URL', "$($Config.DMXAPIBaseUrl)",
    '-DMXAPI_MODEL', "$($Config.DMXAPIModel)",
    '-LogFile', $CurrentLogFile
  )
  if ($SkipInstall) {
    $childArgs += '-SkipInstall'
  }
  if ($SkipOntoGit) {
    $childArgs += '-SkipOntoGit'
  }
  return $childArgs
}

function Start-DetachedProcess {
  param(
    [Parameter(Mandatory)][psobject]$Config,
    [Parameter(Mandatory)][ValidateSet('RunBackend', 'RunFrontend', 'RunGateway', 'RunXiaogugit', 'RunProbability')][string]$ChildMode,
    [Parameter(Mandatory)][string]$CurrentLogFile,
    [Parameter(Mandatory)][string]$PidFile,
    [switch]$SkipInstall,
    [switch]$SkipOntoGit
  )

  Initialize-LogFile -Path $CurrentLogFile
  $childArgs = Get-ChildArgs -Config $Config -ChildMode $ChildMode -CurrentLogFile $CurrentLogFile -SkipInstall:$SkipInstall -SkipOntoGit:$SkipOntoGit
  
  # Join arguments into a single string to avoid ArgumentList array validation issues
  $argString = ""
  foreach ($arg in $childArgs) {
    if ([string]::IsNullOrEmpty($arg)) {
      $argString += ' ""'
    } elseif ($arg -match ' ') {
      $argString += " `"$arg`""
    } else {
      $argString += " $arg"
    }
  }
  $argString = $argString.Trim()

  try {
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $argString -WorkingDirectory $Config.RootDir -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ASCII
    return $process
  } catch {
    Write-Error "Start-Process failed: $_"
    throw
  }
}

function Stop-OntoGitService {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$PidFile,
    [Parameter(Mandatory)][int]$Port
  )

  Write-Host "Stopping old $Name..."
  Stop-PidFileProcess -PidFile $PidFile
  Stop-PortListeners -Port $Port
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    if (@(Get-PortOwnerPids -Port $Port).Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
}

function Invoke-XiaogugitProcess {
  param(
    [Parameter(Mandatory)][psobject]$Config,
    [Parameter(Mandatory)][string]$CurrentLogFile
  )

  Push-Location $Config.XiaoGuGitDir
  try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $env:XG_ENV = 'development'
    $env:XG_HOST = '0.0.0.0'
    $env:XG_PORT = [string]$Config.XiaoGuGitPort
    $env:XG_RELOAD = 'false'
    $env:XG_SERVICE_API_KEY = $Config.GatewayServiceAPIKey
    $env:XG_API_KEY = $Config.GatewayServiceAPIKey
    $env:XG_AUTH_SECRET = $Config.AuthSecret
    $env:XG_AUTH_USERNAME = $Config.AuthUsername
    $env:XG_AUTH_PASSWORD = $Config.AuthPassword
    $env:XG_INFERENCE_URL = "http://127.0.0.1:$($Config.ProbabilityPort)/api/llm/probability-reason"
    Write-LogBanner -Path $CurrentLogFile -Lines @('Starting OntoGit xiaogugit', "DIR: $($Config.XiaoGuGitDir)", "PORT: $($Config.XiaoGuGitPort)")
    Invoke-LoggedCommand -LogPath $CurrentLogFile -Command { & $Config.PythonBin '.\server.py' }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
  }
}

function Invoke-ProbabilityProcess {
  param(
    [Parameter(Mandatory)][psobject]$Config,
    [Parameter(Mandatory)][string]$CurrentLogFile
  )

  Push-Location $Config.ProbabilityDir
  try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $env:PROBABILITY_ENV = 'development'
    $env:HOST = '0.0.0.0'
    $env:PORT = [string]$Config.ProbabilityPort
    $env:UVICORN_RELOAD = 'false'
    $env:XIAOGUGIT_BASE_URL = "http://127.0.0.1:$($Config.XiaoGuGitPort)"
    $env:XIAOGUGIT_API_KEY = $Config.GatewayServiceAPIKey
    $env:GATEWAY_SERVICE_API_KEY = $Config.GatewayServiceAPIKey
    $env:GATEWAY_XG_AUTH_SECRET = $Config.AuthSecret
    $env:GATEWAY_XG_AUTH_USERNAME = $Config.AuthUsername
    if (-not [string]::IsNullOrWhiteSpace($Config.DMXAPIKey)) {
      $env:DMXAPI_API_KEY = $Config.DMXAPIKey
    }
    $env:DMXAPI_BASE_URL = $Config.DMXAPIBaseUrl
    $env:DMXAPI_MODEL = $Config.DMXAPIModel
    Write-LogBanner -Path $CurrentLogFile -Lines @('Starting OntoGit probability', "DIR: $($Config.ProbabilityDir)", "PORT: $($Config.ProbabilityPort)")
    Invoke-LoggedCommand -LogPath $CurrentLogFile -Command { & $Config.PythonBin '.\app\main.py' }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
  }
}

function Invoke-GatewayProcess {
  param(
    [Parameter(Mandatory)][psobject]$Config,
    [Parameter(Mandatory)][string]$CurrentLogFile
  )

  Push-Location $Config.GatewayDir
  try {
    $previousXiaoGuGitUrl = $env:GATEWAY_XIAOGUGIT_URL
    $previousProbabilityUrl = $env:GATEWAY_PROBABILITY_URL
    $previousGatewayAuthSecret = $env:GATEWAY_XG_AUTH_SECRET
    $previousGatewayAuthUsername = $env:GATEWAY_XG_AUTH_USERNAME
    $env:GATEWAY_XIAOGUGIT_URL = "http://127.0.0.1:$($Config.XiaoGuGitPort)"
    $env:GATEWAY_PROBABILITY_URL = "http://127.0.0.1:$($Config.ProbabilityPort)"
    $env:GATEWAY_XG_AUTH_SECRET = $Config.AuthSecret
    $env:GATEWAY_XG_AUTH_USERNAME = $Config.AuthUsername
    $env:GATEWAY_SERVICE_API_KEY = $Config.GatewayServiceAPIKey
    $launchMode = Get-OntoGitGatewayLaunchMode -Config $Config
    if ($null -eq $launchMode) {
      throw 'Cannot start OntoGit gateway: missing gateway.exe, go, and docker.'
    }

    if ($launchMode -eq 'gateway.exe') {
      $gatewayExe = Join-Path $Config.GatewayDir 'gateway.exe'
      Write-LogBanner -Path $CurrentLogFile -Lines @('Starting OntoGit gateway', "GATEWAY_DIR: $($Config.GatewayDir)", "PORT: $($Config.GatewayPort)", 'MODE: gateway.exe')
      Invoke-LoggedCommand -LogPath $CurrentLogFile -Command { & $gatewayExe }
      return
    }

    if ($launchMode -ne 'docker') {
      Write-LogBanner -Path $CurrentLogFile -Lines @('Starting OntoGit gateway', "GATEWAY_DIR: $($Config.GatewayDir)", "PORT: $($Config.GatewayPort)", "MODE: $launchMode run .")
      Invoke-LoggedCommand -LogPath $CurrentLogFile -Command { & $launchMode run . }
      return
    }

    Write-LogBanner -Path $CurrentLogFile -Lines @('Starting OntoGit gateway', "GATEWAY_DIR: $($Config.GatewayDir)", "PORT: $($Config.GatewayPort)", 'MODE: docker compose up -d --build')
    Invoke-LoggedCommand -LogPath $CurrentLogFile -Command { & docker compose up -d --build }
  } finally {
    if ($null -ne $previousXiaoGuGitUrl) {
      $env:GATEWAY_XIAOGUGIT_URL = $previousXiaoGuGitUrl
    } else {
      Remove-Item Env:\GATEWAY_XIAOGUGIT_URL -ErrorAction SilentlyContinue
    }
    if ($null -ne $previousProbabilityUrl) {
      $env:GATEWAY_PROBABILITY_URL = $previousProbabilityUrl
    } else {
      Remove-Item Env:\GATEWAY_PROBABILITY_URL -ErrorAction SilentlyContinue
    }
    if ($null -ne $previousGatewayAuthSecret) {
      $env:GATEWAY_XG_AUTH_SECRET = $previousGatewayAuthSecret
    } else {
      Remove-Item Env:\GATEWAY_XG_AUTH_SECRET -ErrorAction SilentlyContinue
    }
    if ($null -ne $previousGatewayAuthUsername) {
      $env:GATEWAY_XG_AUTH_USERNAME = $previousGatewayAuthUsername
    } else {
      Remove-Item Env:\GATEWAY_XG_AUTH_USERNAME -ErrorAction SilentlyContinue
    }
    Pop-Location
  }
}

function Start-OntoGitGateway {
  param([Parameter(Mandatory)][psobject]$Config)

  if (-not (Test-Path -LiteralPath $Config.GatewayDir -PathType Container)) {
    Write-Host 'OntoGit gateway directory not found; skipping gateway.'
    return
  }

  $launchMode = Get-OntoGitGatewayLaunchMode -Config $Config
  if ($null -eq $launchMode) {
    throw '无法启动 OntoGit gateway：本机缺少 gateway.exe、go 和 docker，请先安装其中一种可用启动方式。'
  }

  $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $Config.GatewayLogFile = Join-Path $Config.LogDir "ontogit-gateway.$runStamp.log"
  $Config.GatewayErrorLogFile = Join-Path $Config.LogDir "ontogit-gateway.$runStamp.err.log"

  Write-Host 'Starting OntoGit gateway...'
  $previousXiaoGuGitUrl = $env:GATEWAY_XIAOGUGIT_URL
  $previousProbabilityUrl = $env:GATEWAY_PROBABILITY_URL
  $previousGatewayAuthSecret = $env:GATEWAY_XG_AUTH_SECRET
  $previousGatewayAuthUsername = $env:GATEWAY_XG_AUTH_USERNAME
  $env:GATEWAY_XIAOGUGIT_URL = "http://127.0.0.1:$($Config.XiaoGuGitPort)"
  $env:GATEWAY_PROBABILITY_URL = "http://127.0.0.1:$($Config.ProbabilityPort)"
  $env:GATEWAY_XG_AUTH_SECRET = $Config.AuthSecret
  $env:GATEWAY_XG_AUTH_USERNAME = $Config.AuthUsername
  $env:GATEWAY_SERVICE_API_KEY = $Config.GatewayServiceAPIKey
  try {
    if ($launchMode -eq 'gateway.exe') {
      Start-NativeServiceProcess `
        -Config $Config `
        -Name 'gateway' `
        -WorkingDirectory $Config.GatewayDir `
        -FilePath (Join-Path $Config.GatewayDir 'gateway.exe') `
        -ArgumentList @() `
        -StdOutLogFile $Config.GatewayLogFile `
        -StdErrLogFile $Config.GatewayErrorLogFile `
        -PidFile $Config.GatewayPidFile | Out-Null
    } elseif ($launchMode -eq 'docker') {
      Start-NativeServiceProcess `
        -Config $Config `
        -Name 'gateway' `
        -WorkingDirectory $Config.GatewayDir `
        -FilePath 'docker' `
        -ArgumentList @('compose', 'up', '-d', '--build') `
        -StdOutLogFile $Config.GatewayLogFile `
        -StdErrLogFile $Config.GatewayErrorLogFile `
        -PidFile $Config.GatewayPidFile | Out-Null
    } else {
      Start-NativeServiceProcess `
        -Config $Config `
        -Name 'gateway' `
        -WorkingDirectory $Config.GatewayDir `
        -FilePath $launchMode `
        -ArgumentList @('run', '.') `
        -StdOutLogFile $Config.GatewayLogFile `
        -StdErrLogFile $Config.GatewayErrorLogFile `
        -PidFile $Config.GatewayPidFile | Out-Null
    }
  } finally {
    if ($null -ne $previousXiaoGuGitUrl) {
      $env:GATEWAY_XIAOGUGIT_URL = $previousXiaoGuGitUrl
    } else {
      Remove-Item Env:\GATEWAY_XIAOGUGIT_URL -ErrorAction SilentlyContinue
    }
    if ($null -ne $previousProbabilityUrl) {
      $env:GATEWAY_PROBABILITY_URL = $previousProbabilityUrl
    } else {
      Remove-Item Env:\GATEWAY_PROBABILITY_URL -ErrorAction SilentlyContinue
    }
    if ($null -ne $previousGatewayAuthSecret) {
      $env:GATEWAY_XG_AUTH_SECRET = $previousGatewayAuthSecret
    } else {
      Remove-Item Env:\GATEWAY_XG_AUTH_SECRET -ErrorAction SilentlyContinue
    }
    if ($null -ne $previousGatewayAuthUsername) {
      $env:GATEWAY_XG_AUTH_USERNAME = $previousGatewayAuthUsername
    } else {
      Remove-Item Env:\GATEWAY_XG_AUTH_USERNAME -ErrorAction SilentlyContinue
    }
  }
  Wait-ForHttpReady -Url "http://127.0.0.1:$($Config.GatewayPort)/health" -Name 'OntoGit gateway'
}

function Start-OntoGitServices {
  param([Parameter(Mandatory)][psobject]$Config)

  if ($Config.UseRemoteOntoGit) {
    Write-Host "Using remote OntoGit gateway: $($Config.OntoGitGatewayUrl)"
    return
  }

  $runStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $Config.XiaoGuGitLogFile = Join-Path $Config.LogDir "xiaogugit.$runStamp.log"
  $Config.XiaoGuGitErrorLogFile = Join-Path $Config.LogDir "xiaogugit.$runStamp.err.log"
  $Config.ProbabilityLogFile = Join-Path $Config.LogDir "probability.$runStamp.log"
  $Config.ProbabilityErrorLogFile = Join-Path $Config.LogDir "probability.$runStamp.err.log"

  Write-Host 'Starting xiaogugit...'
  Start-PythonServiceProcess `
    -Config $Config `
    -Name 'xiaogugit' `
    -WorkingDirectory $Config.XiaoGuGitDir `
    -ScriptPath '.\server.py' `
    -StdOutLogFile $Config.XiaoGuGitLogFile `
    -StdErrLogFile $Config.XiaoGuGitErrorLogFile `
    -PidFile $Config.XiaoGuGitPidFile `
    -EnvironmentOverrides @{
      XG_ENV = 'development'
      XG_HOST = '0.0.0.0'
      XG_PORT = [string]$Config.XiaoGuGitPort
      XG_RELOAD = 'false'
      XG_SERVICE_API_KEY = $Config.GatewayServiceAPIKey
      XG_API_KEY = $Config.GatewayServiceAPIKey
      XG_INFERENCE_URL = "http://127.0.0.1:$($Config.ProbabilityPort)/api/llm/probability-reason"
    } | Out-Null

  Write-Host 'Starting probability...'
  Start-PythonServiceProcess `
    -Config $Config `
    -Name 'probability' `
    -WorkingDirectory $Config.ProbabilityDir `
    -ScriptPath '.\app\main.py' `
    -StdOutLogFile $Config.ProbabilityLogFile `
    -StdErrLogFile $Config.ProbabilityErrorLogFile `
    -PidFile $Config.ProbabilityPidFile `
    -EnvironmentOverrides @{
      PROBABILITY_ENV = 'development'
      HOST = '0.0.0.0'
      PORT = [string]$Config.ProbabilityPort
      UVICORN_RELOAD = 'false'
      XIAOGUGIT_BASE_URL = "http://127.0.0.1:$($Config.XiaoGuGitPort)"
      XIAOGUGIT_API_KEY = $Config.GatewayServiceAPIKey
      GATEWAY_SERVICE_API_KEY = $Config.GatewayServiceAPIKey
      DMXAPI_API_KEY = $Config.DMXAPIKey
      DMXAPI_BASE_URL = $Config.DMXAPIBaseUrl
      DMXAPI_MODEL = $Config.DMXAPIModel
    } | Out-Null

  Wait-ForHttpReady -Url "http://127.0.0.1:$($Config.XiaoGuGitPort)/health" -Name 'xiaogugit'
  Wait-ForHttpReady -Url "http://127.0.0.1:$($Config.ProbabilityPort)/health" -Name 'probability'

  Start-OntoGitGateway -Config $Config
  $Config.OntoGitGatewayUrl = "http://127.0.0.1:$($Config.GatewayPort)"
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
    $env:WIKIMG_ROOT = $Config.WikiMgRoot
    $env:KNOWLEDGE_DATA_ROOT = $Config.KnowledgeDataRoot
    $env:WIKIMG_PROFILE = $Config.WikiMgProfile
    $env:ONTOGIT_STORAGE_ROOT = $Config.SharedStorageRoot
    $env:WIKIMG_ONTOGIT_STORAGE_ROOT = $Config.SharedStorageRoot
    $env:ONTOGIT_GATEWAY_URL = $Config.OntoGitGatewayUrl
    $env:WIKIMG_ONTOGIT_GATEWAY_URL = $Config.OntoGitGatewayUrl
    $env:XG_GATEWAY_URL = $Config.OntoGitGatewayUrl
    $env:GATEWAY_URL = $Config.OntoGitGatewayUrl
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

  $ontoGitLines = if ($Config.UseRemoteOntoGit) {
    @(
      "  OntoGit gateway (remote): $($Config.OntoGitGatewayUrl)"
    )
  } else {
    @(
      "  xiaogugit health: http://127.0.0.1:$($Config.XiaoGuGitPort)/health",
      "  probability health: http://127.0.0.1:$($Config.ProbabilityPort)/health",
      "  OntoGit gateway: http://127.0.0.1:$($Config.GatewayPort)/health"
    )
  }

  $ontoGitLogLines = if ($Config.UseRemoteOntoGit) {
    @(
      '  OntoGit 由远端提供，本地未启动 xiaogugit / probability / gateway'
    )
  } else {
    @(
      "  xiaogugit: $($Config.XiaoGuGitLogFile)",
      "  xiaogugit error: $($Config.XiaoGuGitErrorLogFile)",
      "  probability: $($Config.ProbabilityLogFile)",
      "  probability error: $($Config.ProbabilityErrorLogFile)",
      "  OntoGit gateway: $($Config.GatewayLogFile)"
    )
  }

  @(
    '',
    'Startup complete',
    "  Frontend: http://127.0.0.1:$($Config.FrontendPort)",
    "  Backend health: http://127.0.0.1:$($Config.BackendPort)/api/health",
    $ontoGitLines,
    "  Knowledge data root: $($Config.KnowledgeDataRoot)",
    "  Shared storage: $($Config.SharedStorageRoot)",
    '',
    'Log files:',
    "  Backend: $($Config.BackendLogFile)",
    "  Frontend: $($Config.FrontendLogFile)",
    $ontoGitLogLines
  ) | ForEach-Object { Write-Host $_ }
}

function Start-KimiStack {
  param([Parameter(Mandatory)][psobject]$Config)

  New-Item -ItemType Directory -Force -Path $Config.LogDir | Out-Null
  Assert-Prerequisites -Config $Config
  Write-Host 'Stopping old processes...'
  Stop-PidFileProcess -PidFile $Config.BackendPidFile
  Stop-PidFileProcess -PidFile $Config.FrontendPidFile
  Write-Host "Force clearing ports $Config.BackendPort and $Config.FrontendPort..."
  Get-NetTCPConnection -LocalPort $Config.BackendPort -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Get-NetTCPConnection -LocalPort $Config.FrontendPort -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  if (-not $Config.UseRemoteOntoGit) {
    Stop-OntoGitService -Name 'xiaogugit' -PidFile $Config.XiaoGuGitPidFile -Port $Config.XiaoGuGitPort
    Stop-OntoGitService -Name 'probability' -PidFile $Config.ProbabilityPidFile -Port $Config.ProbabilityPort
    Stop-OntoGitService -Name 'gateway' -PidFile $Config.GatewayPidFile -Port $Config.GatewayPort
  }
  Stop-PortListeners -Port $Config.BackendPort
  Stop-PortListeners -Port $Config.FrontendPort
  Start-OntoGitServices -Config $Config
  Write-Host 'Starting backend...'
  Start-DetachedProcess -Config $Config -ChildMode 'RunBackend' -CurrentLogFile $Config.BackendLogFile -PidFile $Config.BackendPidFile -SkipInstall:$SkipInstall -SkipOntoGit:$SkipOntoGit | Out-Null
  Wait-ForHttpReady -Url "http://127.0.0.1:$($Config.BackendPort)/api/health" -Name 'Backend'
  Write-Host 'Starting frontend...'
  Start-DetachedProcess -Config $Config -ChildMode 'RunFrontend' -CurrentLogFile $Config.FrontendLogFile -PidFile $Config.FrontendPidFile -SkipInstall:$SkipInstall -SkipOntoGit:$SkipOntoGit | Out-Null
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
    'RunGateway' {
      $effectiveLogFile = if ([string]::IsNullOrWhiteSpace($LogFile)) { $config.GatewayLogFile } else { $LogFile }
      Invoke-GatewayProcess -Config $config -CurrentLogFile $effectiveLogFile
      break
    }
    'RunXiaogugit' {
      $effectiveLogFile = if ([string]::IsNullOrWhiteSpace($LogFile)) { $config.XiaoGuGitLogFile } else { $LogFile }
      Invoke-XiaogugitProcess -Config $config -CurrentLogFile $effectiveLogFile
      break
    }
    'RunProbability' {
      $effectiveLogFile = if ([string]::IsNullOrWhiteSpace($LogFile)) { $config.ProbabilityLogFile } else { $LogFile }
      Invoke-ProbabilityProcess -Config $config -CurrentLogFile $effectiveLogFile
      break
    }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  Invoke-ByMode
}
