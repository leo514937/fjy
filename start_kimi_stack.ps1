[CmdletBinding()]
param(
  [ValidateSet('RunStack', 'RunBackend', 'RunFrontend')]
  [string]$Mode = 'RunStack',
  [string]$LogFile,
  [string]$Port = $env:PORT,
  [string]$VitePort = $env:VITE_PORT,
  [string]$PythonBin = $env:PYTHON_BIN,
  [string]$WIKIMG_ROOT = $env:WIKIMG_ROOT,
  [string]$WIKIMG_PROFILE = $env:WIKIMG_PROFILE,
  [string]$KNOWLEDGE_BASE_PROVIDER = $env:KNOWLEDGE_BASE_PROVIDER
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-PythonCommand {
  param(
    [AllowNull()]
    [string]$ExplicitPythonBin
  )

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

function Get-RequiredCommandNames {
  param(
    [Parameter(Mandatory)]
    [string]$PythonBin
  )

  return @('npm', 'node', $PythonBin)
}

function Get-PowerShellExecutablePath {
  $process = Get-Process -Id $PID -ErrorAction SilentlyContinue
  if ($process -and -not [string]::IsNullOrWhiteSpace($process.Path)) {
    return $process.Path
  }

  return 'powershell.exe'
}

function Get-KimiStackConfig {
  $rootDir = Split-Path -Parent $PSCommandPath
  $backendPort = if ([string]::IsNullOrWhiteSpace($Port)) { 8787 } else { [int]$Port }
  $frontendPort = if ([string]::IsNullOrWhiteSpace($VitePort)) { 5173 } else { [int]$VitePort }
  $resolvedPython = Resolve-PythonCommand -ExplicitPythonBin $PythonBin
  $wikiMgRoot = if ([string]::IsNullOrWhiteSpace($WIKIMG_ROOT)) {
    Join-Path $rootDir 'Ontology_Factory'
  } else {
    $WIKIMG_ROOT
  }

  [pscustomobject]@{
    RootDir                 = $rootDir
    ScriptPath              = $PSCommandPath
    PowerShellExecutable    = Get-PowerShellExecutablePath
    AppDir                  = Join-Path $rootDir 'kimi-agent-knowledge-base-collab\app'
    QAgentDir               = Join-Path $rootDir 'QAgent'
    WebRuntimeDir           = Join-Path $rootDir 'kimi-agent-knowledge-base-collab\.qagent-web-runtime'
    LogDir                  = Join-Path $rootDir '.run-logs'
    BackendLogFile          = Join-Path $rootDir '.run-logs\kimi-backend.log'
    FrontendLogFile         = Join-Path $rootDir '.run-logs\kimi-frontend.log'
    BackendPidFile          = Join-Path $rootDir '.run-logs\kimi-backend.pid'
    FrontendPidFile         = Join-Path $rootDir '.run-logs\kimi-frontend.pid'
    BackendPort             = $backendPort
    FrontendPort            = $frontendPort
    PythonBin               = $resolvedPython
    WikiMgRoot              = $wikiMgRoot
    WikiMgProfile           = if ([string]::IsNullOrWhiteSpace($WIKIMG_PROFILE)) { 'kimi' } else { $WIKIMG_PROFILE }
    KnowledgeBaseProvider   = if ([string]::IsNullOrWhiteSpace($KNOWLEDGE_BASE_PROVIDER)) { 'wikimg' } else { $KNOWLEDGE_BASE_PROVIDER }
    WikiMgCliPath           = Join-Path $wikiMgRoot 'WIKI_MG\wikimg'
  }
}

function Assert-StartupPrerequisites {
  param(
    [Parameter(Mandatory)]
    [psobject]$Config
  )

  foreach ($commandName in (Get-RequiredCommandNames -PythonBin $Config.PythonBin)) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
      throw "缺少命令: $commandName"
    }
  }

  if (-not (Test-Path -LiteralPath (Join-Path $Config.AppDir 'node_modules') -PathType Container)) {
    throw "缺少依赖目录: $($Config.AppDir)\node_modules。请先在 $($Config.AppDir) 下执行 npm ci。"
  }

  if (-not (Test-Path -LiteralPath $Config.WikiMgRoot -PathType Container)) {
    throw "未找到 WIKIMG_ROOT: $($Config.WikiMgRoot)"
  }

  if (-not (Test-Path -LiteralPath $Config.WikiMgCliPath -PathType Leaf)) {
    throw "未找到 WiKiMG CLI: $($Config.WikiMgCliPath)"
  }
}

function Get-PortOwnerPids {
  param(
    [Parameter(Mandatory)]
    [int]$Port
  )

  $connections = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if (-not $connections) {
    return @()
  }

  return @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Stop-PortListeners {
  param(
    [Parameter(Mandatory)]
    [int]$Port
  )

  $pids = @(Get-PortOwnerPids -Port $Port)
  if ($pids.Count -eq 0) {
    return
  }

  Write-Host "关闭占用端口 $Port 的旧进程: $($pids -join ', ')"
  foreach ($pidValue in $pids) {
    if ($pidValue -and $pidValue -ne $PID) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    }
  }

  Start-Sleep -Seconds 1
}

function Wait-ForHttpReady {
  param(
    [Parameter(Mandatory)]
    [string]$Url,
    [Parameter(Mandatory)]
    [string]$Name,
    [int]$Retries = 40
  )

  for ($index = 0; $index -lt $Retries; $index += 1) {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
      Write-Host "$Name 已就绪: $Url"
      return
    } catch {
      Start-Sleep -Seconds 1
    }
  }

  throw "$Name 启动超时: $Url"
}

function Wait-ForPortReady {
  param(
    [Parameter(Mandatory)]
    [int]$Port,
    [Parameter(Mandatory)]
    [string]$Name,
    [int]$Retries = 40
  )

  for ($index = 0; $index -lt $Retries; $index += 1) {
    if (@(Get-PortOwnerPids -Port $Port).Count -gt 0) {
      Write-Host "$Name 已监听端口 $Port"
      return
    }

    Start-Sleep -Seconds 1
  }

  throw "$Name 启动超时，端口未监听: $Port"
}

function Get-ChildProcessArgumentList {
  param(
    [Parameter(Mandatory)]
    [string]$ScriptPath,
    [Parameter(Mandatory)]
    [ValidateSet('RunBackend', 'RunFrontend')]
    [string]$Mode,
    [Parameter(Mandatory)]
    [int]$BackendPort,
    [Parameter(Mandatory)]
    [int]$FrontendPort,
    [Parameter(Mandatory)]
    [string]$PythonBin,
    [Parameter(Mandatory)]
    [string]$WikiMgRoot,
    [Parameter(Mandatory)]
    [string]$WikiMgProfile,
    [Parameter(Mandatory)]
    [string]$KnowledgeBaseProvider,
    [Parameter(Mandatory)]
    [string]$LogFile
  )

  return @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $ScriptPath,
    '-Mode', $Mode,
    '-Port', [string]$BackendPort,
    '-VitePort', [string]$FrontendPort,
    '-PythonBin', $PythonBin,
    '-WIKIMG_ROOT', $WikiMgRoot,
    '-WIKIMG_PROFILE', $WikiMgProfile,
    '-KNOWLEDGE_BASE_PROVIDER', $KnowledgeBaseProvider,
    '-LogFile', $LogFile
  )
}

function Initialize-LogFile {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  $directory = Split-Path -Parent $Path
  if (-not [string]::IsNullOrWhiteSpace($directory)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
  }

  Set-Content -LiteralPath $Path -Value '' -Encoding UTF8
}

function Write-LogBanner {
  param(
    [Parameter(Mandatory)]
    [string]$Path,
    [Parameter(Mandatory)]
    [string[]]$Lines
  )

  $content = @(
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')]"
    $Lines
    ''
  ) -join [Environment]::NewLine

  Add-Content -LiteralPath $Path -Value $content -Encoding UTF8
}

function Start-DetachedKimiProcess {
  param(
    [Parameter(Mandatory)]
    [psobject]$Config,
    [Parameter(Mandatory)]
    [ValidateSet('RunBackend', 'RunFrontend')]
    [string]$ChildMode,
    [Parameter(Mandatory)]
    [string]$LogFile,
    [Parameter(Mandatory)]
    [string]$PidFile
  )

  Initialize-LogFile -Path $LogFile

  $arguments = Get-ChildProcessArgumentList `
    -ScriptPath $Config.ScriptPath `
    -Mode $ChildMode `
    -BackendPort $Config.BackendPort `
    -FrontendPort $Config.FrontendPort `
    -PythonBin $Config.PythonBin `
    -WikiMgRoot $Config.WikiMgRoot `
    -WikiMgProfile $Config.WikiMgProfile `
    -KnowledgeBaseProvider $Config.KnowledgeBaseProvider `
    -LogFile $LogFile

  $process = Start-Process `
    -FilePath $Config.PowerShellExecutable `
    -ArgumentList $arguments `
    -WorkingDirectory $Config.RootDir `
    -WindowStyle Hidden `
    -PassThru

  Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ASCII
  return $process
}

function Stop-QAgentGateway {
  param(
    [Parameter(Mandatory)]
    [psobject]$Config
  )

  if (-not (Test-Path -LiteralPath $Config.QAgentDir -PathType Container)) {
    return
  }

  Write-Host '关闭旧的 QAgent web runtime gateway...'
  Push-Location $Config.QAgentDir
  try {
    & node '.\bin\qagent.js' --cwd $Config.WebRuntimeDir gateway stop *> $null
  } catch {
    # 网关可能从未启动，忽略即可。
  } finally {
    Pop-Location
  }
}

function Invoke-LoggedCommand {
  param(
    [Parameter(Mandatory)]
    [string]$LogPath,
    [Parameter(Mandatory)]
    [scriptblock]$Command
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
    [Parameter(Mandatory)]
    [psobject]$Config,
    [Parameter(Mandatory)]
    [string]$CurrentLogFile
  )

  Push-Location $Config.AppDir
  try {
    $env:KNOWLEDGE_BASE_PROVIDER = $Config.KnowledgeBaseProvider
    $env:WIKIMG_ROOT = $Config.WikiMgRoot
    $env:WIKIMG_PROFILE = $Config.WikiMgProfile
    $env:PYTHON_BIN = $Config.PythonBin
    $env:PORT = [string]$Config.BackendPort

    Write-LogBanner -Path $CurrentLogFile -Lines @(
      '正在启动 WiKiMG 后端（PowerShell 原生入口）',
      "APP_DIR: $($Config.AppDir)",
      "KNOWLEDGE_BASE_PROVIDER: $($Config.KnowledgeBaseProvider)",
      "WIKIMG_ROOT: $($Config.WikiMgRoot)",
      "WIKIMG_PROFILE: $($Config.WikiMgProfile)",
      "PYTHON_BIN: $($Config.PythonBin)",
      "PORT: $($Config.BackendPort)"
    )

    Invoke-LoggedCommand -LogPath $CurrentLogFile -Command {
      & node '.\server.mjs'
    }
  } finally {
    Pop-Location
  }
}

function Invoke-FrontendProcess {
  param(
    [Parameter(Mandatory)]
    [psobject]$Config,
    [Parameter(Mandatory)]
    [string]$CurrentLogFile
  )

  Push-Location $Config.AppDir
  try {
    Write-LogBanner -Path $CurrentLogFile -Lines @(
      '正在启动前端开发服务器（PowerShell 原生入口）',
      "APP_DIR: $($Config.AppDir)",
      "PORT: $($Config.FrontendPort)"
    )

    Invoke-LoggedCommand -LogPath $CurrentLogFile -Command {
      & npm.cmd run dev -- --host 0.0.0.0 --port ([string]$Config.FrontendPort)
    }
  } finally {
    Pop-Location
  }
}

function Show-StartupSummary {
  param(
    [Parameter(Mandatory)]
    [psobject]$Config
  )

  @(
    '',
    '启动完成',
    "  前端: http://localhost:$($Config.FrontendPort)",
    "  后端健康检查: http://localhost:$($Config.BackendPort)/api/health",
    '',
    '日志文件',
    "  前端: $($Config.FrontendLogFile)",
    "  后端: $($Config.BackendLogFile)",
    '',
    '常用命令',
    "  查看前端日志: Get-Content -Wait '$($Config.FrontendLogFile)'",
    "  查看后端日志: Get-Content -Wait '$($Config.BackendLogFile)'"
  ) | ForEach-Object { Write-Host $_ }
}

function Start-KimiStack {
  param(
    [Parameter(Mandatory)]
    [psobject]$Config
  )

  New-Item -ItemType Directory -Force -Path $Config.LogDir | Out-Null
  Assert-StartupPrerequisites -Config $Config

  Write-Host '关闭旧进程...'
  Stop-QAgentGateway -Config $Config
  Stop-PortListeners -Port $Config.BackendPort
  Stop-PortListeners -Port $Config.FrontendPort

  Write-Host '启动后端...'
  Start-DetachedKimiProcess -Config $Config -ChildMode 'RunBackend' -LogFile $Config.BackendLogFile -PidFile $Config.BackendPidFile | Out-Null
  Wait-ForHttpReady -Url "http://localhost:$($Config.BackendPort)/api/health" -Name '后端'

  Write-Host '启动前端...'
  Start-DetachedKimiProcess -Config $Config -ChildMode 'RunFrontend' -LogFile $Config.FrontendLogFile -PidFile $Config.FrontendPidFile | Out-Null
  Wait-ForPortReady -Port $Config.FrontendPort -Name '前端'

  Show-StartupSummary -Config $Config
}

function Invoke-KimiStackByMode {
  $config = Get-KimiStackConfig

  switch ($Mode) {
    'RunStack' {
      Start-KimiStack -Config $config
      break
    }
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
    default {
      throw "不支持的模式: $Mode"
    }
  }
}

if ($MyInvocation.InvocationName -ne '.') {
  Invoke-KimiStackByMode
}
