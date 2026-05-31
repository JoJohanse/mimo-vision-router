# MiMo Vision Router

让 MiMo V2.5 Pro 纯文本模型秒变多模态，自动处理图片输入。

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

| AI 助手 | API 格式 | 安装命令 |
|---------|----------|----------|
| OpenCode | OpenAI | `.\setup.ps1` |
| Claude Code | Anthropic | `.\setup-claude.ps1` |

## 安装

### 前置条件

- Node.js v18+
- 小米 MiMo API Key

### OpenCode

```powershell
git clone https://github.com/JoJohanse/mimo-vision-router.git
cd mimo-vision-router
.\setup.ps1
# 重启 OpenCode，选择 "MiMo V2.5 Pro (Auto Vision)" 模型
```

### Claude Code

```powershell
.\setup-claude.ps1
# 使用启动器
.\start-claude.ps1
# 或手动
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:3456"
claude
```

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

编辑 `proxy/server.js`：

```javascript
const PORT = 3456;                                    // 代理端口
const UPSTREAM_HOST = 'token-plan-cn.xiaomimimo.com'; // 小米 API
const VISION_MODEL = 'mimo-v2.5';                     // 多模态模型
```

## 故障排除

```powershell
# 检查代理状态
curl http://127.0.0.1:3456/health

# 检查端口占用
netstat -ano | findstr :3456

# 手动启动
node proxy/server.js
```

**图片未处理？**
- OpenCode：确认选择 "MiMo V2.5 Pro (Auto Vision)"
- Claude Code：确认环境变量 `ANTHROPIC_BASE_URL` 已设置

## 项目结构

```
mimo-vision-router/
├── setup.ps1              # OpenCode 安装
├── setup-claude.ps1       # Claude Code 安装
├── README.md / CLAUDE.md  # 文档
└── proxy/
    ├── server.js          # 代理服务器
    ├── mcp-launcher.js    # MCP 生命周期管理
    └── start.ps1          # 手动管理
```

## 链接

- **小米 MiMo**: https://xiaomimimo.com
- **OpenCode**: https://opencode.ai
- **Claude Code**: https://docs.anthropic.com/claude-code

## License

MIT
