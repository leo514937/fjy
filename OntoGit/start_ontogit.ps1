$ErrorActionPreference = "Stop"
$WorkingDir = "D:\code\FJY\OntoGit"

# Ensure log directory exists
$LogDir = Join-Path $WorkingDir ".run-logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}

Write-Host "正在关闭旧的 OntoGit 进程..."
# 查杀占用 8000（XiaoGuGit），5000（Probability），8080（Gateway）的进程
$ports = @(8000, 5000, 8080)
foreach ($port in $ports) {
    try {
        $pids = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess
        foreach ($p in $pids) {
            if ($p -and $p -ne 0) {
                Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
                Write-Host "已关闭占用端口 $port 的进程 (PID: $p)"
            }
        }
    } catch {}
}

Write-Host "正在启动服务集群..."

Write-Host "  -> 启动 Probability 推理引擎 (端口 5000)..."
Start-Process -FilePath "python" -ArgumentList "app/main.py" -WorkingDirectory (Join-Path $WorkingDir "probability") -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir "probability.log") -RedirectStandardError (Join-Path $LogDir "probability_err.log")

Write-Host "  -> 启动 XiaoGuGit 版本管理引擎 (端口 8000)..."
Start-Process -FilePath "python" -ArgumentList "server.py" -WorkingDirectory (Join-Path $WorkingDir "xiaogugit") -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir "xiaogugit.log") -RedirectStandardError (Join-Path $LogDir "xiaogugit_err.log")

Write-Host "  -> 启动 Gateway 统一安全网关 (端口 8080)..."
$env:GATEWAY_SERVICE_API_KEY = "change-me"
$env:GATEWAY_ADDR = ":8080"
$env:GATEWAY_XIAOGUGIT_URL = "http://127.0.0.1:8000"
$env:GATEWAY_PROBABILITY_URL = "http://127.0.0.1:5000"

Start-Process -FilePath (Join-Path $WorkingDir "gateway\gateway.exe") -WorkingDirectory (Join-Path $WorkingDir "gateway") -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir "gateway.log") -RedirectStandardError (Join-Path $LogDir "gateway_err.log")

# 简单等待进程稍作启动
Start-Sleep -Seconds 3

Write-Host "============================="
Write-Host " OntoGit 服务栈启动完成！"
Write-Host "============================="
Write-Host "统一访问网关: http://127.0.0.1:8080"
Write-Host "中台可视化版: http://127.0.0.1:8080/ui-dashboard"
Write-Host "XiaoGuGit API: http://127.0.0.1:8000"
Write-Host "Probability API: http://127.0.0.1:5000"
Write-Host ""
Write-Host "如果需要调试，可以通过以下命令查看对应模块的实时日志："
Write-Host "  查看网关日志: Get-Content -Wait '$LogDir\gateway.log'"
Write-Host "  查看版本引擎: Get-Content -Wait '$LogDir\xiaogugit.log'"
Write-Host "  查看推理服务: Get-Content -Wait '$LogDir\probability.log'"
