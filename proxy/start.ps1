# MiMo Vision Proxy - 手动管理脚本
# 使用方式:
#   .\start.ps1         启动代理
#   .\start.ps1 stop    停止代理
#   .\start.ps1 status  查看状态

param([string]$Action = "start")

$ProxyScript = Join-Path $PSScriptRoot "server.js"
$Port = 3456

function Start-Proxy {
    $existing = Get-Process -Name "node" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*server.js*" -or ($_.MainWindowTitle -eq "" -and (Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue)) }

    if ($existing) {
        Write-Host "✓ Proxy already running (PID: $($existing.Id))"
        return
    }

    # 在隐藏窗口中启动
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = "node"
    $startInfo.Arguments = "`"$ProxyScript`""
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $proc = [System.Diagnostics.Process]::Start($startInfo)

    # 等待服务启动
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -ErrorAction Stop
        Write-Host "✓ MiMo Vision Proxy started (PID: $($proc.Id))" -ForegroundColor Green
        Write-Host "  Listening on http://127.0.0.1:$Port"
        Write-Host "  Upstream: https://token-plan-cn.xiaomimimo.com/v1"
    } catch {
        Write-Host "✗ Proxy started but not responding yet. Check logs." -ForegroundColor Yellow
        Write-Host "  PID: $($proc.Id)"
    }
}

function Stop-Proxy {
    # 查找占用端口的 node 进程
    $processes = Get-Process -Name "node" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*server.js*" }

    if (-not $processes) {
        # 也可以通过端口查找
        try {
            $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
            if ($conn) {
                $processes = $conn | ForEach-Object { Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue }
            }
        } catch {}
    }

    if ($processes) {
        $processes | ForEach-Object {
            Write-Host "  Stopping PID $($_.Id)..."
            Stop-Process -Id $_.Id -Force
        }
        Write-Host "✓ Proxy stopped" -ForegroundColor Green
    } else {
        Write-Host "Proxy not running" -ForegroundColor Yellow
    }
}

function Get-Status {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -ErrorAction Stop
        Write-Host "✓ Proxy is running" -ForegroundColor Green
        Write-Host "  Status: $($response.status)"
        Write-Host "  URL: http://127.0.0.1:$Port"

        # 显示进程信息
        $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($conn) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            Write-Host "  PID: $($proc.Id)"
            Write-Host "  Started: $($proc.StartTime)"
        }
    } catch {
        Write-Host "✗ Proxy is not running" -ForegroundColor Red
    }
}

switch ($Action) {
    "start"  { Start-Proxy }
    "stop"   { Stop-Proxy }
    "status" { Get-Status }
    default  { Write-Host "Usage: .\start.ps1 [start|stop|status]" }
}
