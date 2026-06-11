# MiMo Vision Router

让 MiMo V2.5 Pro 纯文本模型秒变多模态，自动处理图片输入。

[English](README.en.md)

## 背景

小米 MiMo 模型有两个版本：
- **MiMo V2.5**：支持多模态（图片+文本）
- **MiMo V2.5 Pro**：纯文本，不支持图片

**问题**：使用 Pro 模型时无法直接发送图片。

**方案**：本地代理自动将图片转为文字描述，Pro 模型也能"看懂"图片。

## 架构

```
Claude Code → localhost:3456 (代理)
  → 检测图片 → mimo-v2.5 (Anthropic) 描述图片
  → 替换为文字 → mimo-v2.5-pro (Anthropic)
  → 返回结果

OpenCode → localhost:3456 (代理)
  → 检测图片 → mimo-v2.5 (OpenAI) 描述图片
  → 替换为文字 → mimo-v2.5-pro (OpenAI)
  → 返回结果
```

两条路径完全独立：
- **Anthropic 路径**：Claude Code → 代理 → 小米 Anthropic 端点 (`/anthropic/v1/messages`)
- **OpenAI 路径**：OpenCode → 代理 → 小米 OpenAI 端点 (`/v1/chat/completions`)

## 支持的 AI 助手

| AI 助手 | API 格式 | 安装命令 | 自动启动 |
|---------|----------|----------|----------|
| OpenCode | OpenAI | `.\setup.ps1` | MCP |
| Claude Code | Anthropic | `.\setup-claude.ps1` | MCP |

## 安装

### 前置条件

- Node.js v18+
- 小米 MiMo API Key（从 [xiaomimimo.com](https://xiaomimimo.com) 获取）

### OpenCode

```powershell
git clone https://github.com/JoJohanse/mimo-vision-router.git
cd mimo-vision-router
.\setup.ps1
# 脚本会提示输入 API Key 和 Base URL
# 重启 OpenCode，选择 "MiMo V2.5 Pro (Auto Vision)" 模型
```

### Claude Code

```powershell
git clone https://github.com/JoJohanse/mimo-vision-router.git
cd mimo-vision-router
.\setup-claude.ps1
# 脚本会提示输入 API Key
# 重启 Claude Code，直接使用即可（默认 sonnet → mimo-v2.5-pro）
```

安装完成后，代理会通过 MCP **自动启动**，无需手动运行。

### 安装注意事项

> **请在运行安装脚本前仔细阅读以下内容。**

#### 端口占用清理

安装脚本会自动检测端口 `3456` 是否被占用。如果有旧的代理进程正在运行，脚本会**自动终止**该进程以释放端口。

#### Claude Code 配置覆盖

运行 `setup-claude.ps1` 时，脚本会**覆盖** `~/.claude/settings.json` 中的环境变量配置，写入以下内容：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:3456` | 本地代理地址 |
| `ANTHROPIC_AUTH_TOKEN` | 用户 API Key | 认证密钥 |
| `ANTHROPIC_SMALL_FAST_MODEL` | `mimo-v2.5` | 后台任务模型 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `mimo-v2.5` | haiku 别名映射 |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `mimo-v2.5-pro` | sonnet 别名映射（显示为 MiMo V2.5 Pro (Auto Vision)） |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `mimo-v2.5-pro` | opus 别名映射（显示为 MiMo V2.5 Pro (Auto Vision)） |
| `model` | `sonnet` | 默认使用 sonnet |

脚本会在覆盖前显示当前配置与新配置的对比，并要求用户输入 `y` 确认。

#### 备份建议

如果需要保留原有配置，建议先手动备份：

```powershell
Copy-Item "$env:USERPROFILE\.claude\settings.json" "$env:USERPROFILE\.claude\settings.json.bak"
```

## 功能特性

- **MCP 自动启动**：代理随 AI 助手自动启动/关闭
- **图片自动处理**：检测图片 → 生成描述 → 替换为文字
- **双格式支持**：同时支持 OpenAI 和 Anthropic API 格式
- **模型变体**：支持 low/medium/high 推理深度
- **一键安装**：交互式配置 API 凭证

## 配置

### 代理配置

编辑 `proxy/server.js`：

```javascript
const PORT = 3456;                                    // 代理端口
const UPSTREAM_HOST = 'token-plan-cn.xiaomimimo.com'; // 小米 API
const VISION_MODEL = 'mimo-v2.5';                     // 多模态模型（用于图片描述）
```

### Claude Code 模型映射

Claude Code 使用内置别名（sonnet/haiku/opus）映射到 MiMo 模型：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:3456",
    "ANTHROPIC_AUTH_TOKEN": "tp-xxxx",
    "ANTHROPIC_SMALL_FAST_MODEL": "mimo-v2.5",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "mimo-v2.5",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "mimo-v2.5-pro",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "mimo-v2.5-pro"
  },
  "model": "sonnet"
}
```

| 别名 | 映射模型 | 说明 |
|------|----------|------|
| `haiku` | `mimo-v2.5` | 快速/轻量任务 |
| `sonnet` | `mimo-v2.5-pro` | 默认主力模型 |
| `opus` | `mimo-v2.5-pro` | 复杂推理任务 |

### 模型变体

通过模型名后缀控制推理深度：

| 模型 | 说明 |
|------|------|
| `mimo-v2.5-pro` | 默认（无变体） |
| `mimo-v2.5-pro-low` | 低推理深度 |
| `mimo-v2.5-pro-medium` | 中等推理深度 |
| `mimo-v2.5-pro-high` | 高推理深度 |

## 故障排除

```powershell
# 检查代理状态
curl http://127.0.0.1:3456/health

# 检查 MCP 服务器
claude mcp list

# 检查端口占用
netstat -ano | findstr :3456

# 手动启动代理
node proxy/server.js
```

**图片未处理？**
- Claude Code：确认 `ANTHROPIC_BASE_URL` 指向 `http://127.0.0.1:3456`
- OpenCode：确认选择 "MiMo V2.5 Pro (Auto Vision)"

**模型不可用？**
- 确认 `ANTHROPIC_DEFAULT_SONNET_MODEL` 设置为 `mimo-v2.5-pro`
- 不要使用 `/model` 选择自定义模型名，使用标准别名（sonnet/haiku/opus）

**连接不上 API？**
- 检查 MCP 配置格式是否正确（OpenCode 要求 `command` + `args` 分开写）：
  ```json
  "mcp": {
    "mimo-proxy": {
      "command": "node",
      "args": ["C:\\path\\to\\mcp-launcher.js"]
    }
  }
  ```
  ❌ 错误格式：`"command": ["node", "..."]` 或包含 `"type": "local"`
- 重新安装：`.\setup.ps1` 会自动写入正确格式

## 项目结构

```
mimo-vision-router/
├── setup.ps1              # OpenCode 安装脚本
├── setup-claude.ps1       # Claude Code 安装脚本
├── README.md              # 中文文档
├── README.en.md           # 英文文档
├── CLAUDE.md              # Claude Code 项目说明
└── proxy/
    ├── server.js          # 代理服务器（支持 OpenAI/Anthropic）
    ├── mcp-launcher.js    # MCP 生命周期管理
    └── start.ps1          # 手动管理脚本
```

## 链接

- **小米 MiMo**: https://xiaomimimo.com
- **OpenCode**: https://opencode.ai
- **Claude Code**: https://docs.anthropic.com/claude-code

## License

MIT
