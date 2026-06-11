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
    [string]$BaseUrl,
    [int]$Port = 3456
)

$ErrorActionPreference = 'Stop'

function Write-Ok   { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Err  { param($msg) Write-Host "  ✗ $msg" -ForegroundColor Red }
function Write-Warn { param($msg) Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Step { param($msg) Write-Host "`n$msg" -ForegroundColor Cyan }

# ─── 1. 检查 Node.js ──────────────────────────────────────────

Write-Step "[1/7] Checking Node.js..."
try {
    $nodeVer = & node --version 2>&1
    Write-Ok "Node.js $nodeVer"
} catch {
    Write-Err "Node.js not found. Install from https://nodejs.org/"
    exit 1
}

# ─── 2. 检查 Claude Code ─────────────────────────────────────

Write-Step "[2/7] Checking Claude Code..."
try {
    $claudeVer = & claude --version 2>&1
    Write-Ok "Claude Code $claudeVer"
} catch {
    Write-Warn "Claude Code not found in PATH. Install with: npm install -g @anthropic-ai/claude-code"
    Write-Host "  Continuing anyway..."
}

# ─── 3. 配置 API 凭证 ────────────────────────────────────────

Write-Step "[3/7] Configuring API credentials..."

# 获取 API Key
if (-not $ApiKey) {
    Write-Host "  Enter your Xiaomi MiMo API Key:" -ForegroundColor Yellow
    Write-Host "  (Format: tp-xxxx, get from https://xiaomimimo.com)" -ForegroundColor Gray
    $ApiKey = Read-Host "  API Key"
    if (-not $ApiKey) {
        Write-Err "API Key is required"
        exit 1
    }
}
Write-Ok "API Key configured"

# 获取 Base URL
if (-not $BaseUrl) {
    $defaultUrl = "https://token-plan-cn.xiaomimimo.com/anthropic"
    Write-Host "  Enter API Base URL (press Enter for default):" -ForegroundColor Yellow
    Write-Host "  Default: $defaultUrl" -ForegroundColor Gray
    $inputUrl = Read-Host "  Base URL"
    if ($inputUrl) {
        $BaseUrl = $inputUrl
    } else {
        $BaseUrl = $defaultUrl
    }
}
Write-Ok "Base URL: $BaseUrl"

# ─── 4. 复制代理文件 ──────────────────────────────────────────

Write-Step "[4/7] Installing proxy..."

$installDir = "$env:USERPROFILE\.config\mimo-vision-router"
if (-not (Test-Path $installDir)) {
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
}

$installerDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$files = @("server.js", "mcp-launcher.js", "start.ps1")

foreach ($f in $files) {
    $src = Join-Path (Join-Path $installerDir "proxy") $f
    $dst = Join-Path $installDir $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $dst -Force
        Write-Ok "$f"
    } else {
        Write-Err "Source not found: $src"
        exit 1
    }
}

# ─── 5. 创建启动脚本 ──────────────────────────────────────────

Write-Step "[5/7] Creating launcher..."

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

# ─── 6. 配置 MCP 服务器（代理跟随 Claude 自动启动） ──────────

Write-Step "[6/7] Configuring MCP server..."

$mcpLauncher = Join-Path $installDir "mcp-launcher.js"
try {
    # 移除已有的 mimo-proxy MCP 配置（如果存在）
    & claude mcp remove mimo-proxy 2>$null
} catch {}

try {
    & claude mcp add mimo-proxy -- node $mcpLauncher
    Write-Ok "MCP server 'mimo-proxy' configured"
    Write-Host "  Proxy will auto-start when Claude Code launches" -ForegroundColor Gray
} catch {
    Write-Warn "Failed to configure MCP server. You can manually start the proxy with start-claude.ps1"
}

# 创建快速启动脚本
$quickStart = "$env:USERPROFILE\.config\mimo-vision-router\claude.cmd"
$quickStartContent = @"
@echo off
powershell -ExecutionPolicy Bypass -File "$installDir\start-claude.ps1" %*
"@
Set-Content -Path $quickStart -Value $quickStartContent -Encoding ASCII
Write-Ok "claude.cmd (quick launcher)"

# ─── 7. 写入环境变量到 Claude Code 配置 ──────────────────────

Write-Step "[7/7] Writing environment variables to Claude Code settings..."

$claudeSettingsPath = "$env:USERPROFILE\.claude\settings.json"
if (Test-Path $claudeSettingsPath) {
    try {
        $settings = Get-Content $claudeSettingsPath -Raw | ConvertFrom-Json
        
        # 确保 env 节点存在
        if (-not $settings.env) {
            $settings | Add-Member -NotePropertyName "env" -NotePropertyValue @{} -Force
        }
        
        # 写入环境变量
        $settings.env.ANTHROPIC_AUTH_TOKEN = $ApiKey
        $settings.env.ANTHROPIC_BASE_URL = $BaseUrl
        
        # 保存配置
        $settings | ConvertTo-Json -Depth 10 | Set-Content $claudeSettingsPath -Encoding UTF8
        Write-Ok "Environment variables written to settings.json"
        Write-Host "  ANTHROPIC_AUTH_TOKEN: $($ApiKey.Substring(0, [Math]::Min(8, $ApiKey.Length)))..." -ForegroundColor Gray
        Write-Host "  ANTHROPIC_BASE_URL: $BaseUrl" -ForegroundColor Gray
    } catch {
        Write-Warn "Failed to update settings.json: $_"
        Write-Host "  Please manually add these to $claudeSettingsPath" -ForegroundColor Yellow
    }
} else {
    Write-Warn "Claude Code settings.json not found at $claudeSettingsPath"
    Write-Host "  Please manually create settings.json with:" -ForegroundColor Yellow
    Write-Host "  {`"env`": {`"ANTHROPIC_AUTH_TOKEN`": `"$ApiKey`", `"ANTHROPIC_BASE_URL`": `"$BaseUrl`"}}" -ForegroundColor Gray
}

# ─── 完成 ─────────────────────────────────────────────────────

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Proxy will auto-start when Claude Code launches." -ForegroundColor Cyan
Write-Host ""
Write-Host "  Usage:"
Write-Host "    # Just run Claude Code normally:"
Write-Host "    claude"
Write-Host ""
Write-Host "    # Or use the launcher (manual proxy control):"
Write-Host "    cd $installDir"
Write-Host "    .\start-claude.ps1"
Write-Host ""
Write-Host "  Verify MCP server:"
Write-Host "    claude mcp list"
Write-Host ""
Write-Host "  Proxy installed to: $installDir"
Write-Host ""
