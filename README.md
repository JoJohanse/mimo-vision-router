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
AI 助手 → localhost:3456 (代理)
  → 检测图片 → V2.5 提取描述
  → 替换为文字 → V2.5 Pro
  → 返回结果
```

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
# 脚本会提示输入 API Key 和 Base URL
# 重启 Claude Code，使用 /model 选择 sonnet (MiMo V2.5 Pro)
```

安装完成后，代理会通过 MCP **自动启动**，无需手动运行。

## 功能特性

- **MCP 自动启动**：代理随 AI 助手自动启动/关闭
- **图片自动处理**：检测图片 → 生成描述 → 替换为文字
- **双格式支持**：同时支持 OpenAI 和 Anthropic API 格式
- **模型变体**：支持 low/medium/high/max 推理深度
- **一键安装**：交互式配置 API 凭证

## 技术实现

两条路径完全独立，不共用图片处理逻辑：

**OpenAI 路径 (OpenCode)**：
```javascript
// 检测图片 → V2.5 描述 → 替换为文字 → 转发 V2.5 Pro
function openaiHasImages(content) {
  return Array.isArray(content) && content.some(p => p.type === 'image_url');
}
```

**Anthropic 路径 (Claude Code)**：
```javascript
// 检测图片 → V2.5 描述 → 格式转换 → 转发 V2.5 Pro
function anthropicHasImages(content) {
  return Array.isArray(content) && content.some(p => p.type === 'image');
}
```

## 配置

### 代理配置

编辑 `proxy/server.js`：

```javascript
const PORT = 3456;                                    // 代理端口
const UPSTREAM_HOST = 'token-plan-cn.xiaomimimo.com'; // 小米 API
const VISION_MODEL = 'mimo-v2.5';                     // 多模态模型
```

### Claude Code 模型映射

Claude Code 使用内置别名（sonnet/haiku/opus）映射到自定义模型：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:3456",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "mimo-v2.5-pro-auto-vision",
    "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "MiMo V2.5 Pro (Auto Vision)"
  },
  "model": "sonnet"
}
```

### 模型变体

通过模型名后缀控制推理深度：

| 模型 | 说明 |
|------|------|
| `mimo-v2.5-pro-auto-vision` | 默认（无变体） |
| `mimo-v2.5-pro-auto-vision-low` | 低推理深度 |
| `mimo-v2.5-pro-auto-vision-medium` | 中等推理深度 |
| `mimo-v2.5-pro-auto-vision-high` | 高推理深度 |
| `mimo-v2.5-pro-auto-vision-max` | 最大推理深度 |

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
- OpenCode：确认选择 "MiMo V2.5 Pro (Auto Vision)"
- Claude Code：确认 `ANTHROPIC_BASE_URL` 指向 `http://127.0.0.1:3456`

**模型不可用？**
- Claude Code：使用 `/model` 选择 `sonnet`（会显示为 MiMo V2.5 Pro）
- 确认 `ANTHROPIC_DEFAULT_SONNET_MODEL` 已设置

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
