# MiMo Vision Router

将 `mimo-v2.5-pro` 纯文本模型升级为自动支持图片输入的代理方案。支持 **OpenCode** 和 **Claude Code**。

## 原理

```
AI 助手 (发消息 + 图片)
  → 本地代理 localhost:3456
    → 检测到图片 → 调 mimo-v2.5 提取描述
    → 替换图片为文字 → 转发给 mimo-v2.5-pro
    → 返回结果
```

## 文件清单

```
mimo-vision-router/
├── setup.ps1              # OpenCode 一键安装
├── setup-claude.ps1       # Claude Code 一键安装
├── README.md              # 本文档
├── CLAUDE.md              # Claude Code 项目说明
└── proxy/
    ├── server.js          # 代理服务器 (支持 OpenAI + Anthropic API)
    ├── mcp-launcher.js    # MCP 生命周期管理器 (OpenCode)
    └── start.ps1          # 手动管理脚本
```

## 快速开始

### OpenCode

```powershell
.\setup.ps1
# 重启 OpenCode，选择 "MiMo V2.5 Pro (Auto Vision)" 模型
```

### Claude Code

```powershell
.\setup-claude.ps1
# 使用启动器运行
.\start-claude.ps1
# 或
claude.cmd
```

## API 兼容性

代理同时支持两种 API 格式：

| 客户端 | 端点 | 格式 |
|--------|------|------|
| OpenCode | `POST /v1/chat/completions` | OpenAI |
| Claude Code | `POST /v1/messages` | Anthropic |

## 手动管理代理

```powershell
cd proxy
.\start.ps1 status   # 查看状态
.\start.ps1 stop     # 停止
.\start.ps1 start    # 启动
```

## 配置说明

编辑 `proxy/server.js` 顶部的常量：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `3456` | 代理监听端口 |
| `UPSTREAM_HOST` | `token-plan-cn.xiaomimimo.com` | Xiaomi API 地址 |
| `VISION_MODEL` | `mimo-v2.5` | 用于图片描述的多模态模型 |

## 故障排除

**代理没启动？**
```powershell
node --version                    # 检查 Node.js
netstat -ano | findstr :3456      # 检查端口占用
curl http://127.0.0.1:3456/health # 测试代理
```

**Claude Code 连不上？**
```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:3456"
$env:ANTHROPIC_API_KEY = "your-api-key"
claude
```

## 卸载

1. 删除 `~/.config/mimo-vision-router/` 目录
2. OpenCode: 从 `opencode.json` 删除 `xiaomi-mimo-proxy` provider 和 MCP 配置
3. Claude Code: 取消 `ANTHROPIC_BASE_URL` 环境变量
