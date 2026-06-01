#Requires -Version 5.1
<#
.SYNOPSIS
    MiMo Vision Proxy 一键安装脚本

.DESCRIPTION
    将代理服务器和 MCP 生命周期管理器安装到 OpenCode 配置目录，
    并自动修补 opencode.json 和 oh-my-openagent.json。

.PARAMETER ApiKey
    Xiaomi MiMo Token Plan API Key。不传则使用默认值或提示输入。

.PARAMETER OpenCodeDir
    OpenCode 配置目录路径。默认自动检测 (~/.config/opencode)。

.PARAMETER Port
    代理监听端口。默认 3456。

.EXAMPLE
    .\setup.ps1
    .\setup.ps1 -ApiKey "tp-xxxx" -Port 3457
#>

param(
    [string]$ApiKey,
    [string]$OpenCodeDir,
    [int]$Port = 3456
)

$ErrorActionPreference = 'Stop'

# ─── 颜色输出 ──────────────────────────────────────────────────

function Write-Ok   { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Err  { param($msg) Write-Host "  ✗ $msg" -ForegroundColor Red }
function Write-Warn { param($msg) Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Step { param($msg) Write-Host "`n$msg" -ForegroundColor Cyan }

# ─── 0. 检测 OpenCode 配置目录 ─────────────────────────────────

Write-Step "[1/6] Detecting OpenCode config directory..."

if (-not $OpenCodeDir) {
    $candidates = @(
        "$env:USERPROFILE\.config\opencode",
        "$env:APPDATA\opencode",
        "$env:LOCALAPPDATA\opencode"
    )
    foreach ($c in $candidates) {
        if (Test-Path "$c\opencode.json") {
            $OpenCodeDir = $c
            break
        }
    }
}

if (-not $OpenCodeDir -or -not (Test-Path "$OpenCodeDir\opencode.json")) {
    Write-Err "OpenCode config not found. Searched:"
    foreach ($c in $candidates) { Write-Host "    $c" }
    Write-Host "  Use -OpenCodeDir to specify the path manually."
    exit 1
}

Write-Ok "Found: $OpenCodeDir"

# ─── 1. 检查 Node.js ──────────────────────────────────────────

Write-Step "[2/6] Checking Node.js..."

try {
    $nodeVer = & node --version 2>&1
    Write-Ok "Node.js $nodeVer"
} catch {
    Write-Err "Node.js not found in PATH."
    Write-Host "  Install from https://nodejs.org/ (v18+ recommended)"
    exit 1
}

# ─── 2. 复制代理文件 ──────────────────────────────────────────

Write-Step "[3/6] Copying proxy files..."

$proxyDir = Join-Path $OpenCodeDir "proxy"
if (-not (Test-Path $proxyDir)) {
    New-Item -ItemType Directory -Path $proxyDir -Force | Out-Null
}

$installerDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$files = @("server.js", "mcp-launcher.js", "start.ps1")

foreach ($f in $files) {
    $src = Join-Path (Join-Path $installerDir "proxy") $f
    $dst = Join-Path $proxyDir $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $dst -Force
        Write-Ok "proxy/$f"
    } else {
        Write-Err "Source not found: $src"
        exit 1
    }
}

# ─── 3. 修补 opencode.json ───────────────────────────────────

Write-Step "[4/6] Patching opencode.json..."

$configPath = Join-Path $OpenCodeDir "opencode.json"
$config = Get-Content $configPath -Raw | ConvertFrom-Json

# 确保 provider 节点存在
if (-not $config.provider) {
    $config | Add-Member -NotePropertyName "provider" -NotePropertyValue @{} -Force
}

# 添加 xiaomi-mimo-proxy provider (如果不存在)
$providerKey = "xiaomi-mimo-proxy"
if (-not $config.provider.$providerKey) {
    $proxyProvider = @{
        models = @{
            "mimo-v2.5-pro-auto-vision" = @{
                modalities = @{
                    input  = @("text", "image")
                    output = @("text")
                }
                name  = "MiMo V2.5 Pro (Auto Vision)"
                limit = @{
                    context = 1000000
                    output  = 128000
                }
            }
        }
        name    = "Xiaomi MiMo Proxy"
        npm     = "@ai-sdk/openai-compatible"
        options = @{
            apiKey     = if ($ApiKey) { $ApiKey } else { "YOUR_API_KEY_HERE" }
            baseURL    = "http://127.0.0.1:$Port/v1"
            setCacheKey = $true
        }
    }
    $config.provider | Add-Member -NotePropertyName $providerKey -NotePropertyValue $proxyProvider -Force
    Write-Ok "Added provider: $providerKey"
} else {
    Write-Warn "Provider '$providerKey' already exists, skipping"
    # 更新 baseURL 中的端口
    $config.provider.$providerKey.options.baseURL = "http://127.0.0.1:$Port/v1"
    if ($ApiKey) {
        $config.provider.$providerKey.options.apiKey = $ApiKey
    }
}

# 添加 MCP 配置 (如果不存在)
if (-not $config.mcp) {
    $config | Add-Member -NotePropertyName "mcp" -NotePropertyValue @{} -Force
}

$mcpKey = "mimo-proxy"
if (-not $config.mcp.$mcpKey) {
    $launcherPath = (Join-Path $proxyDir "mcp-launcher.js") -replace '\\', '\\'
    $mcpConfig = @{
        command = "node"
        args    = @($launcherPath)
    }
    $config.mcp | Add-Member -NotePropertyName $mcpKey -NotePropertyValue $mcpConfig -Force
    Write-Ok "Added MCP server: $mcpKey"
} else {
    Write-Warn "MCP server '$mcpKey' already exists, skipping"
}

# 设置默认 model (如果未设置)
if (-not $config.model) {
    $config | Add-Member -NotePropertyName "model" -NotePropertyValue "xiaomi-mimo-proxy/mimo-v2.5-pro-auto-vision" -Force
    Write-Ok "Set default model: xiaomi-mimo-proxy/mimo-v2.5-pro-auto-vision"
} else {
    Write-Warn "Default model already set: $($config.model)"
}

# 添加 instructions (如果不存在)
$prefsFile = Join-Path $OpenCodeDir "preferences.md"
if (-not $config.instructions) {
    $config | Add-Member -NotePropertyName "instructions" -NotePropertyValue @($prefsFile -replace '\\', '\\') -Force
    Write-Ok "Added instructions reference"
} else {
    Write-Warn "Instructions already configured"
}

# 写回配置
$config | ConvertTo-Json -Depth 20 | Set-Content $configPath -Encoding UTF8
Write-Ok "opencode.json updated"

# ─── 4. 修补 oh-my-openagent.json ────────────────────────────

Write-Step "[5/6] Patching oh-my-openagent.json..."

$omaPath = Join-Path $OpenCodeDir "oh-my-openagent.json"
if (Test-Path $omaPath) {
    $oma = Get-Content $omaPath -Raw | ConvertFrom-Json

    if (-not $oma.agents) {
        $oma | Add-Member -NotePropertyName "agents" -NotePropertyValue @{} -Force
    }

    # hephaestus → proxy model
    if ($oma.agents.hephaestus) {
        $oma.agents.hephaestus.model = "xiaomi-mimo-proxy/mimo-v2.5-pro-auto-vision"
        Write-Ok "hephaestus → xiaomi-mimo-proxy/mimo-v2.5-pro-auto-vision"
    } else {
        Write-Warn "hephaestus agent not found, skipping"
    }

    # multimodal-looker → mimo-v2.5 (多模态)
    if ($oma.agents.'multimodal-looker') {
        $oma.agents.'multimodal-looker'.model = "xiaomi-token-plan-cn/mimo-v2.5"
        Write-Ok "multimodal-looker → xiaomi-token-plan-cn/mimo-v2.5"
    } else {
        Write-Warn "multimodal-looker agent not found, skipping"
    }

    $oma | ConvertTo-Json -Depth 20 | Set-Content $omaPath -Encoding UTF8
    Write-Ok "oh-my-openagent.json updated"
} else {
    Write-Warn "oh-my-openagent.json not found, skipping"
    Write-Host "  If you use oh-my-openagent, manually add agent configs."
}

# ─── 5. 验证 ──────────────────────────────────────────────────

Write-Step "[6/6] Verifying installation..."

# 检查文件完整性
$allFilesExist = $true
foreach ($f in $files) {
    $path = Join-Path $proxyDir $f
    if (Test-Path $path) {
        Write-Ok "proxy/$f exists"
    } else {
        Write-Err "proxy/$f MISSING"
        $allFilesExist = $false
    }
}

# 验证 JSON 格式
try {
    Get-Content $configPath -Raw | ConvertFrom-Json | Out-Null
    Write-Ok "opencode.json is valid JSON"
} catch {
    Write-Err "opencode.json is INVALID JSON!"
    $allFilesExist = $false
}

# 检查代理是否可启动
Write-Host ""
Write-Host "  Testing proxy startup..." -ForegroundColor Gray
$testProc = Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "`"$(Join-Path $proxyDir 'server.js')`"" -PassThru
Start-Sleep -Seconds 2

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -ErrorAction Stop
    Write-Ok "Proxy responds: $($health.status)"
} catch {
    Write-Warn "Proxy not responding (may need API key to be set)"
} finally {
    Stop-Process -Id $testProc.Id -Force -ErrorAction SilentlyContinue
}

# ─── 完成 ─────────────────────────────────────────────────────

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Installation complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Verify your API key in opencode.json"
Write-Host "       (search for 'xiaomi-mimo-proxy')"
Write-Host "    2. Restart OpenCode"
Write-Host "    3. Select model: MiMo V2.5 Pro (Auto Vision)"
Write-Host "    4. Send a message with an image!"
Write-Host ""
Write-Host "  Manual proxy control:"
Write-Host "    cd $proxyDir"
Write-Host "    .\start.ps1 [start|stop|status]"
Write-Host ""
