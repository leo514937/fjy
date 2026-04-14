Set-StrictMode -Version Latest

Describe 'start_kimi_stack.ps1' {
  BeforeAll {
    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    $script:ScriptPath = Join-Path $repoRoot 'start_kimi_stack.ps1'
    . $script:ScriptPath
  }

  It '只要求 Windows 友好的命令依赖' {
    $requirements = Get-RequiredCommandNames -PythonBin 'python'

    $requirements | Should Be @('npm', 'node', 'python')
    ($requirements -contains 'bash') | Should Be $false
    ($requirements -contains 'curl') | Should Be $false
    ($requirements -contains 'lsof') | Should Be $false
  }

  It '在未显式指定时优先解析 Windows 常见的 Python 命令' {
    Mock Get-Command { [pscustomobject]@{ Name = 'python'; Source = 'C:\Python312\python.exe' } } -ParameterFilter { $Name -eq 'python' }
    Mock Get-Command { throw 'missing' } -ParameterFilter { $Name -eq 'python3' }
    Mock Get-Command { throw 'missing' } -ParameterFilter { $Name -eq 'py' }

    $result = Resolve-PythonCommand -ExplicitPythonBin $null

    $result | Should Be 'python'
  }

  It '后台子进程会复用同一个脚本并切换到后端模式' {
    $arguments = Get-ChildProcessArgumentList `
      -ScriptPath 'D:\code\FJY\start_kimi_stack.ps1' `
      -Mode 'RunBackend' `
      -BackendPort 8787 `
      -FrontendPort 5173 `
      -PythonBin 'python' `
      -WikiMgRoot 'D:\code\FJY\Ontology_Factory' `
      -WikiMgProfile 'kimi' `
      -KnowledgeBaseProvider 'wikimg' `
      -LogFile 'D:\code\FJY\.run-logs\kimi-backend.log'

    ($arguments -contains '-File') | Should Be $true
    ($arguments -contains 'D:\code\FJY\start_kimi_stack.ps1') | Should Be $true
    ($arguments -contains '-Mode') | Should Be $true
    ($arguments -contains 'RunBackend') | Should Be $true
    ($arguments -contains '-LogFile') | Should Be $true
    ($arguments -contains 'D:\code\FJY\.run-logs\kimi-backend.log') | Should Be $true
  }

  It '只有一个端口占用进程时也能正常停止' {
    Mock Get-PortOwnerPids { 1234 }
    Mock Stop-Process {}
    Mock Start-Sleep {}

    $threw = $false
    try {
      Stop-PortListeners -Port 8787
    } catch {
      $threw = $true
    }

    $threw | Should Be $false
    Assert-MockCalled Stop-Process -Times 1 -Exactly -ParameterFilter { $Id -eq 1234 }
  }

  It '命令输出会以统一的 UTF-8 文本写入日志' {
    $logPath = Join-Path $TestDrive 'kimi.log'
    Initialize-LogFile -Path $logPath

    Invoke-LoggedCommand -LogPath $logPath -Command {
      Write-Output 'hello'
    }

    $bytes = [System.IO.File]::ReadAllBytes($logPath)

    ($bytes -contains 0) | Should Be $false
  }
}
