# MiMo Vision Proxy - 鍚姩绠＄悊鑴氭湰
# 浣跨敤鏂瑰紡:
#   .\start.ps1         鍚姩浠ｇ悊
#   .\start.ps1 stop    鍋滄浠ｇ悊
#   .\start.ps1 status  鏌ョ湅鐘舵€?
param([string]$Action = "start")

$ProxyScript = "C:\Users\Johnn\.config\opencode\proxy\server.js"
$Port = 3456

function Start-Proxy {
    $existing = Get-Process -Name "node" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*server.js*" -or ($_.MainWindowTitle -eq "" -and (Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue)) }

    if ($existing) {
        Write-Host "鉁?Proxy already running (PID: $($existing.Id))"
        return
    }

    # 鍦ㄩ殣钘忕獥鍙ｄ腑鍚姩
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = "node"
    $startInfo.Arguments = "`"$ProxyScript`""
    $startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    $proc = [System.Diagnostics.Process]::Start($startInfo)

    # 绛夊緟鏈嶅姟鍚姩
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -ErrorAction Stop
        Write-Host "鉁?MiMo Vision Proxy started (PID: $($proc.Id))" -ForegroundColor Green
        Write-Host "  Listening on http://127.0.0.1:$Port"
        Write-Host "  Upstream: https://token-plan-cn.xiaomimimo.com/v1"
    } catch {
        Write-Host "鉁?Proxy started but not responding yet. Check logs." -ForegroundColor Yellow
        Write-Host "  PID: $($proc.Id)"
    }
}

function Stop-Proxy {
    # 鏌ユ壘鍗犵敤绔彛鐨?node 杩涚▼
    $processes = Get-Process -Name "node" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*server.js*" }

    if (-not $processes) {
        # 涔熷彲浠ラ€氳繃绔彛鏌ユ壘
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
        Write-Host "鉁?Proxy stopped" -ForegroundColor Green
    } else {
        Write-Host "Proxy not running" -ForegroundColor Yellow
    }
}

function Get-Status {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -ErrorAction Stop
        Write-Host "鉁?Proxy is running" -ForegroundColor Green
        Write-Host "  Status: $($response.status)"
        Write-Host "  URL: http://127.0.0.1:$Port"

        # 鏄剧ず杩涚▼淇℃伅
        $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($conn) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            Write-Host "  PID: $($proc.Id)"
            Write-Host "  Started: $($proc.StartTime)"
        }
    } catch {
        Write-Host "鉁?Proxy is not running" -ForegroundColor Red
    }
}

switch ($Action) {
    "start"  { Start-Proxy }
    "stop"   { Stop-Proxy }
    "status" { Get-Status }
    default  { Write-Host "Usage: .\start.ps1 [start|stop|status]" }
}

