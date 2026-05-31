#Requires -Version 5.1
<#
.SYNOPSIS
    MiMo Vision Proxy - Claude Code 一键安装脚本

.DESCRIPTION
    安装代理服务器并配置 Claude Code 使用 MiMo 模型。

.PARAMETER ApiKey
    Xiaomi MiMo API Key。不传则提示输入。

.PARAMETER Port
    代理监听端口。默认 3456。

.EXAMPLE
    .\setup-claude.ps1
    .\setup-claude.ps1 -ApiKey "tp-xxxx"
#>

param(
    [string]$ApiKey,
    [int]$Port = 3456
)

$ErrorActionPreference = 'Stop'

function Write-Ok   { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Err  { param($msg) Write-Host "  ✗ $msg" -ForegroundColor Red }
function Write-Warn { param($msg) Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Step { param($msg) Write-Host "`n$msg" -ForegroundColor Cyan }

# ─── 1. 检查 Node.js ──────────────────────────────────────────

Write-Step "[1/5] Checking Node.js..."
try {
    $nodeVer = & node --version 2>&1
    Write-Ok "Node.js $nodeVer"
} catch {
    Write-Err "Node.js not found. Install from https://nodejs.org/"
    exit 1
}

# ─── 2. 检查 Claude Code ─────────────────────────────────────

Write-Step "[2/5] Checking Claude Code..."
try {
    $claudeVer = & claude --version 2>&1
    Write-Ok "Claude Code $claudeVer"
} catch {
    Write-Warn "Claude Code not found in PATH. Install with: npm install -g @anthropic-ai/claude-code"
    Write-Host "  Continuing anyway..."
}

# ─── 3. 复制代理文件 ──────────────────────────────────────────

Write-Step "[3/5] Installing proxy..."

$installDir = "$env:USERPROFILE\.config\mimo-vision-router"
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

$installerDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$files = @("server.js", "start.ps1")

foreach ($f in $files) {
    $src = Join-Path $installerDir "proxy" $f
    $dst = Join-Path $installDir $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $dst -Force
        Write-Ok "$f"
    } else {
        Write-Err "Source not found: $src"
        exit 1
    }
}

# ─── 4. 创建启动脚本 ──────────────────────────────────────────

Write-Step "[4/5] Creating launcher..."

$launcherPath = Join-Path $installDir "start-claude.ps1"
$launcherContent = @"
# MiMo Vision Proxy + Claude Code Launcher
# Usage: .\start-claude.ps1 [claude args...]

param([string]`$ClaudeArgs = "")

`$proxyScript = Join-Path `$PSScriptRoot "server.js"
`$port = $Port

# 检查代理是否已运行
function Test-ProxyRunning {
    try {
        `$null = Invoke-RestMethod -Uri "http://127.0.0.1:`$port/health" -TimeoutSec 2 -ErrorAction Stop
        return `$true
    } catch {
        return `$false
    }
}

# 启动代理
if (-not (Test-ProxyRunning)) {
    Write-Host "Starting MiMo Vision Proxy..." -ForegroundColor Cyan
    `$startInfo = New-Object System.Diagnostics.ProcessStartInfo
    `$startInfo.FileName = "node"
    `$startInfo.Arguments = "`"`$proxyScript`""
    `$startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    `$startInfo.UseShellExecute = `$false
    `$null = [System.Diagnostics.Process]::Start(`$startInfo)

    # 等待代理就绪
    for (`$i = 0; `$i -lt 10; `$i++) {
        Start-Sleep -Milliseconds 500
        if (Test-ProxyRunning) {
            Write-Host "  Proxy ready" -ForegroundColor Green
            break
        }
    }
    if (-not (Test-ProxyRunning)) {
        Write-Host "  Proxy failed to start!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Proxy already running" -ForegroundColor Green
}

# 设置环境变量
`$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:`$port"
if (-not `$env:ANTHROPIC_API_KEY) {
    `$env:ANTHROPIC_API_KEY = "$ApiKey"
}

Write-Host "Launching Claude Code..." -ForegroundColor Cyan
Write-Host "  API: `$env:ANTHROPIC_BASE_URL" -ForegroundColor Gray

# 启动 Claude Code
if (`$ClaudeArgs) {
    Invoke-Expression "claude `$ClaudeArgs"
} else {
    claude
}
"@

Set-Content -Path $launcherPath -Value $launcherContent -Encoding UTF8
Write-Ok "start-claude.ps1"

# ─── 5. 创建快速启动脚本 (用户目录) ──────────────────────────

$quickStart = "$env:USERPROFILE\.config\mimo-vision-router\claude.cmd"
$quickStartContent = @"
@echo off
powershell -ExecutionPolicy Bypass -File "$installDir\start-claude.ps1" %*
"@
Set-Content -Path $quickStart -Value $quickStartContent -Encoding ASCII
Write-Ok "claude.cmd (quick launcher)"

# ─── 完成 ─────────────────────────────────────────────────────

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Usage:"
Write-Host "    # Option 1: Direct launch"
Write-Host "    cd $installDir"
Write-Host "    .\start-claude.ps1"
Write-Host ""
Write-Host "    # Option 2: Quick command"
Write-Host "    claude.cmd"
Write-Host ""
Write-Host "    # Option 3: Manual"
Write-Host "    `$env:ANTHROPIC_BASE_URL = 'http://127.0.0.1:$Port'"
Write-Host "    `$env:ANTHROPIC_API_KEY = 'your-api-key'"
Write-Host "    claude"
Write-Host ""
Write-Host "  Proxy installed to: $installDir"
Write-Host ""
