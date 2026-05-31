# MiMo Vision Proxy - Installer

将 `mimo-v2.5-pro` 纯文本模型升级为自动支持图片输入的代理方案。

## 原理

```
OpenCode (发消息 + 图片)
  → 本地代理 localhost:3456
    → 检测到图片 → 调 mimo-v2.5 提取描述
    → 替换图片为文字 → 转发给 mimo-v2.5-pro
    → 返回结果
```

## 文件清单

```
mimo-vision-router/
├── setup.ps1              # 一键安装脚本
├── README.md              # 本文档
├── CLAUDE.md              # Claude Code 项目说明
└── proxy/
    ├── server.js          # 代理服务器
    ├── mcp-launcher.js    # MCP 生命周期管理器
    └── start.ps1          # 手动管理脚本 (可选)
```

## 安装

### 前置条件

- Node.js (v18+)
- OpenCode 已安装并配置过至少一个 provider

### 步骤

1. 把整个 `mimo-proxy-installer` 文件夹复制到目标机器
2. 打开 PowerShell，进入该目录
3. 运行安装脚本：

```powershell
.\setup.ps1
```

如果需要自定义 API Key：

```powershell
.\setup.ps1 -ApiKey "your-api-key-here"
```

4. 重启 OpenCode

安装脚本会自动：
- 复制代理文件到 `~/.config/opencode/proxy/`
- 在 `opencode.json` 中添加代理 provider 和 MCP 配置
- 更新 `oh-my-openagent.json` 中相关 agent 的模型指向
- 验证 Node.js 和代理服务可用性

## 使用

安装后重启 OpenCode，代理会通过 MCP 自动启动。

在模型选择器中选择 **"MiMo V2.5 Pro (Auto Vision)"**，然后正常发图片即可。

### 手动管理代理

```powershell
cd ~/.config/opencode/proxy
.\start.ps1 status   # 查看状态
.\start.ps1 stop     # 停止
.\start.ps1 start    # 启动
```

## 卸载

1. 从 `opencode.json` 中删除 `xiaomi-mimo-proxy` provider 和 `mcp.mimo-proxy-manager` 配置
2. 从 `oh-my-openagent.json` 中恢复 agent 模型配置
3. 删除 `~/.config/opencode/proxy/` 目录
4. 重启 OpenCode

## 配置说明

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `UPSTREAM_HOST` | `token-plan-cn.xiaomimimo.com` | Xiaomi API 地址 |
| `PORT` | `3456` | 代理监听端口 |
| `VISION_MODEL` | `mimo-v2.5` | 用于图片描述的多模态模型 |

如需修改，编辑 `proxy/server.js` 顶部的常量。

## 故障排除

**代理没启动？**
- 检查 Node.js 是否在 PATH 中：`node --version`
- 检查端口 3456 是否被占用：`netstat -ano | findstr :3456`

**图片没被处理？**
- 确认在 OpenCode 中选择了 "MiMo V2.5 Pro (Auto Vision)" 模型
- 检查代理是否运行：`curl http://127.0.0.1:3456/health`

**API Key 错误？**
- 编辑 `opencode.json` 中 `xiaomi-mimo-proxy` provider 的 `apiKey`
