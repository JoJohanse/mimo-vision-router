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
    $defaultUrl = "http://127.0.0.1:3456"
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

# 杀掉占用端口的旧进程（可能来自其他代理如 opencode）
$portCheck = netstat -ano 2>$null | Select-String ":${Port}\s.*LISTENING"
if ($portCheck) {
    $oldPid = ($portCheck -split '\s+')[-1]
    if ($oldPid -match '^\d+$') {
        $oldProc = Get-Process -Id ([int]$oldPid) -ErrorAction SilentlyContinue
        if ($oldProc) {
            Write-Warn "Port $Port is in use by: $($oldProc.ProcessName) (PID $oldPid)"
            Write-Host "  Killing old process to free port..." -ForegroundColor Yellow
            Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
            Write-Ok "Port $Port freed"
        }
    }
}

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
if (-not `$env:ANTHROPIC_AUTH_TOKEN) {
    `$env:ANTHROPIC_AUTH_TOKEN = "$ApiKey"
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

# 创建全局 MCP 配置文件（确保在任何目录都能跟随启动）
$globalMcpConfigPath = "$env:USERPROFILE\.claude\mcp.json"
$globalMcpConfig = @{
    mcpServers = @{
        "mimo-vision-proxy" = @{
            command = "node"
            args = @($mcpLauncher.Replace('\', '/'))
            env = @{}
            disabled = $false
        }
    }
}

try {
    # 确保 .claude 目录存在
    $claudeDir = "$env:USERPROFILE\.claude"
    if (-not (Test-Path $claudeDir)) {
        New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
    }

    # 如果已存在配置文件，合并配置
    if (Test-Path $globalMcpConfigPath) {
        try {
            $existingConfig = Get-Content $globalMcpConfigPath -Raw | ConvertFrom-Json
            if ($existingConfig.mcpServers) {
                # 添加或更新 mimo-vision-proxy 配置
                $existingConfig.mcpServers | Add-Member -MemberType NoteProperty -Name "mimo-vision-proxy" -Value $globalMcpConfig.mcpServers."mimo-vision-proxy" -Force
                $globalMcpConfig = $existingConfig
            }
        } catch {
            Write-Warn "Failed to read existing mcp.json, will overwrite"
        }
    }

    # 写入配置
    $globalMcpConfig | ConvertTo-Json -Depth 10 | Set-Content $globalMcpConfigPath -Encoding UTF8
    Write-Ok "Global MCP config created: $globalMcpConfigPath"
    Write-Host "  Proxy will auto-start in any directory" -ForegroundColor Gray
} catch {
    Write-Warn "Failed to create global MCP config: $_"
    Write-Host "  Falling back to project-level MCP config..." -ForegroundColor Yellow

    # 备选方案：使用 claude mcp add 命令
    try {
        & claude mcp remove mimo-proxy 2>$null
    } catch {}

    try {
        & claude mcp add mimo-proxy -- node $mcpLauncher
        Write-Ok "MCP server 'mimo-proxy' configured (project-level)"
        Write-Host "  Note: This may only work in the current directory" -ForegroundColor Yellow
    } catch {
        Write-Warn "Failed to configure MCP server. You can manually start the proxy with start-claude.ps1"
    }
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
        
        # 显示当前配置并警告用户
        Write-Host ""
        Write-Host "  ⚠️  WARNING: This will overwrite your existing Claude Code settings!" -ForegroundColor Yellow
        Write-Host "  ─────────────────────────────────────────────────────────────────" -ForegroundColor Yellow
        
        if ($settings.env.ANTHROPIC_BASE_URL) {
            Write-Host "  Current ANTHROPIC_BASE_URL: $($settings.env.ANTHROPIC_BASE_URL)" -ForegroundColor Gray
        }
        if ($settings.env.ANTHROPIC_AUTH_TOKEN) {
            $maskedToken = if ($settings.env.ANTHROPIC_AUTH_TOKEN.Length -gt 8) { 
                "$($settings.env.ANTHROPIC_AUTH_TOKEN.Substring(0, 8))..." 
            } else { 
                "***" 
            }
            Write-Host "  Current ANTHROPIC_AUTH_TOKEN: $maskedToken" -ForegroundColor Gray
        }
        if ($settings.env.ANTHROPIC_MODEL) {
            Write-Host "  Current ANTHROPIC_MODEL: $($settings.env.ANTHROPIC_MODEL)" -ForegroundColor Gray
        }
        if ($settings.model) {
            Write-Host "  Current model: $($settings.model)" -ForegroundColor Gray
        }
        
        Write-Host ""
        Write-Host "  New settings:" -ForegroundColor Cyan
        Write-Host "  ANTHROPIC_BASE_URL: $BaseUrl" -ForegroundColor Cyan
        Write-Host "  ANTHROPIC_AUTH_TOKEN: $($ApiKey.Substring(0, [Math]::Min(8, $ApiKey.Length)))..." -ForegroundColor Cyan
        Write-Host "  model: sonnet" -ForegroundColor Cyan
        Write-Host ""
        
        # 确认是否继续
        $confirm = Read-Host "  Continue? (y/N)"
        if ($confirm -ne 'y' -and $confirm -ne 'Y') {
            Write-Warn "Skipped settings update"
            Write-Host "  You can manually update $claudeSettingsPath" -ForegroundColor Yellow
            return
        }
        
        # 用新 env 对象整体替换（避免 PSCustomObject 无法新增属性的问题）
        $newEnv = @{
            ANTHROPIC_AUTH_TOKEN = $ApiKey
            ANTHROPIC_BASE_URL = $BaseUrl
            ANTHROPIC_SMALL_FAST_MODEL = "mimo-v2.5"
            ANTHROPIC_DEFAULT_HAIKU_MODEL = "mimo-v2.5"
            ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME = "MiMo V2.5"
            ANTHROPIC_DEFAULT_SONNET_MODEL = "mimo-v2.5-pro-auto-version"
            ANTHROPIC_DEFAULT_SONNET_MODEL_NAME = "MiMo V2.5 Pro(Auto Version)"
            ANTHROPIC_DEFAULT_OPUS_MODEL = "mimo-v2.5-pro-auto-version"
            ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = "MiMo V2.5 Pro(Auto Version)"
        }
        $settings.env = $newEnv
        
        # 设置默认模型为 sonnet (会映射到 mimo-v2.5-pro)
        $settings | Add-Member -MemberType NoteProperty -Name "model" -Value "sonnet" -Force
        
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
    Write-Host "  {`"env`": {`"ANTHROPIC_AUTH_TOKEN`": `"$ApiKey`", `"ANTHROPIC_BASE_URL`": `"$BaseUrl`", `"ANTHROPIC_CUSTOM_MODEL_OPTION`": `"mimo-v2.5-pro-auto-vision`"}}" -ForegroundColor Gray
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
