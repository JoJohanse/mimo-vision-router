# MiMo Vision Router

Turn MiMo V2.5 Pro text-only model into multimodal with automatic image processing.

[中文](README.md)

## Background

Xiaomi MiMo has two model versions:
- **MiMo V2.5**: Multimodal (images + text)
- **MiMo V2.5 Pro**: Text-only, no image support

**Problem**: Cannot send images when using the Pro model.

**Solution**: A local proxy automatically converts images to text descriptions, enabling the Pro model to "see" images.

## Architecture

```
Claude Code → localhost:3456 (proxy)
  → Detect images → mimo-v2.5 (Anthropic) describes images
  → Replace with text → mimo-v2.5-pro (Anthropic)
  → Return result

OpenCode → localhost:3456 (proxy)
  → Detect images → mimo-v2.5 (OpenAI) describes images
  → Replace with text → mimo-v2.5-pro (OpenAI)
  → Return result
```

Two completely independent paths:
- **Anthropic path**: Claude Code → proxy → Xiaomi Anthropic endpoint (`/anthropic/v1/messages`)
- **OpenAI path**: OpenCode → proxy → Xiaomi OpenAI endpoint (`/v1/chat/completions`)

## Supported AI Assistants

| AI Assistant | API Format | Install Command | Auto-Start |
|--------------|------------|-----------------|------------|
| OpenCode | OpenAI | `.\setup.ps1` | MCP |
| Claude Code | Anthropic | `.\setup-claude.ps1` | MCP |

## Installation

### Prerequisites

- Node.js v18+
- Xiaomi MiMo API Key (get from [xiaomimimo.com](https://xiaomimimo.com))

### OpenCode

```powershell
git clone https://github.com/JoJohanse/mimo-vision-router.git
cd mimo-vision-router
.\setup.ps1
# Script will prompt for API Key and Base URL
# Restart OpenCode, select "MiMo V2.5 Pro (Auto Vision)" model
```

### Claude Code

```powershell
git clone https://github.com/JoJohanse/mimo-vision-router.git
cd mimo-vision-router
.\setup-claude.ps1
# Script will prompt for API Key
# Restart Claude Code, just start using it (default sonnet → mimo-v2.5-pro)
```

After installation, the proxy **auto-starts** via MCP - no manual startup needed.

### Installation Notes

> **Please read the following carefully before running the installation script.**

#### Port Cleanup

The setup script automatically checks if port `3456` is in use. If an old proxy process is running, the script will **automatically kill** it to free the port.

#### Claude Code Configuration Overwrite

When running `setup-claude.ps1`, the script will **overwrite** environment variables in `~/.claude/settings.json`:

| Setting | Value | Description |
|---------|-------|-------------|
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:3456` | Local proxy address |
| `ANTHROPIC_AUTH_TOKEN` | User API Key | Authentication |
| `ANTHROPIC_SMALL_FAST_MODEL` | `mimo-v2.5` | Background tasks model |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `mimo-v2.5` | haiku alias mapping |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `mimo-v2.5-pro` | sonnet alias mapping (displays as MiMo V2.5 Pro (Auto Vision)) |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `mimo-v2.5-pro` | opus alias mapping (displays as MiMo V2.5 Pro (Auto Vision)) |
| `model` | `sonnet` | Default model |

The script displays a comparison of current vs. new settings and requires you to type `y` to confirm.

#### Backup Recommendation

To preserve your existing configuration, back it up first:

```powershell
Copy-Item "$env:USERPROFILE\.claude\settings.json" "$env:USERPROFILE\.claude\settings.json.bak"
```

## Features

- **MCP Auto-Start**: Proxy starts/stops automatically with AI assistants
- **Automatic Image Processing**: Detect images → generate descriptions → replace with text
- **Dual Format Support**: Both OpenAI and Anthropic API formats
- **Model Variants**: Support low/medium/high reasoning depth
- **One-Click Install**: Interactive API credential configuration

## Configuration

### Proxy Configuration

Edit `proxy/server.js`:

```javascript
const PORT = 3456;                                    // Proxy port
const UPSTREAM_HOST = 'token-plan-cn.xiaomimimo.com'; // Xiaomi API
const VISION_MODEL = 'mimo-v2.5';                     // Multimodal model (for image description)
```

### Claude Code Model Mapping

Claude Code uses built-in aliases (sonnet/haiku/opus) mapped to MiMo models:

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

| Alias | Mapped Model | Description |
|-------|--------------|-------------|
| `haiku` | `mimo-v2.5` | Fast/light tasks |
| `sonnet` | `mimo-v2.5-pro` | Default main model |
| `opus` | `mimo-v2.5-pro` | Complex reasoning tasks |

### Model Variants

Control reasoning depth via model name suffix:

| Model | Description |
|-------|-------------|
| `mimo-v2.5-pro` | Default (no variant) |
| `mimo-v2.5-pro-low` | Low reasoning depth |
| `mimo-v2.5-pro-medium` | Medium reasoning depth |
| `mimo-v2.5-pro-high` | High reasoning depth |

## Troubleshooting

```powershell
# Check proxy status
curl http://127.0.0.1:3456/health

# Check MCP servers
claude mcp list

# Check port usage
netstat -ano | findstr :3456

# Manually start proxy
node proxy/server.js
```

**Images not processed?**
- Claude Code: Confirm `ANTHROPIC_BASE_URL` points to `http://127.0.0.1:3456`
- OpenCode: Confirm "MiMo V2.5 Pro (Auto Vision)" is selected

**Model not available?**
- Confirm `ANTHROPIC_DEFAULT_SONNET_MODEL` is set to `mimo-v2.5-pro`
- Do NOT use `/model` to select custom model names - use standard aliases (sonnet/haiku/opus)

**Cannot connect to API?**
- Check MCP configuration format (OpenCode requires `command` + `args` separate):
  ```json
  "mcp": {
    "mimo-proxy": {
      "command": "node",
      "args": ["C:\\path\\to\\mcp-launcher.js"]
    }
  }
  ```
  ❌ Wrong format: `"command": ["node", "..."]` or includes `"type": "local"`
- Reinstall: `.\setup.ps1` will automatically write correct format

## Project Structure

```
mimo-vision-router/
├── setup.ps1              # OpenCode installation script
├── setup-claude.ps1       # Claude Code installation script
├── README.md              # Chinese documentation
├── README.en.md           # English documentation
├── CLAUDE.md              # Claude Code project description
└── proxy/
    ├── server.js          # Proxy server (OpenAI/Anthropic support)
    ├── mcp-launcher.js    # MCP lifecycle management
    └── start.ps1          # Manual management script
```

## Links

- **Xiaomi MiMo**: https://xiaomimimo.com
- **OpenCode**: https://opencode.ai
- **Claude Code**: https://docs.anthropic.com/claude-code

## License

MIT
