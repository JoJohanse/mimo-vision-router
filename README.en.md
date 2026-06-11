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
AI Assistant → localhost:3456 (proxy)
  → Detect images → V2.5 extracts description
  → Replace with text → V2.5 Pro
  → Return result
```

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
# Script will prompt for API Key and Base URL
# Restart Claude Code, use /model to select sonnet (MiMo V2.5 Pro)
```

After installation, the proxy **auto-starts** via MCP - no manual startup needed.

## Features

- **MCP Auto-Start**: Proxy starts/stops automatically with AI assistants
- **Automatic Image Processing**: Detect images → generate descriptions → replace with text
- **Dual Format Support**: Both OpenAI and Anthropic API formats
- **Model Variants**: Support low/medium/high/max reasoning depth
- **One-Click Install**: Interactive API credential configuration

## Technical Implementation

Two completely independent paths with separate image processing logic:

**OpenAI Path (OpenCode)**:
```javascript
// Detect images → V2.5 description → replace with text → forward to V2.5 Pro
function openaiHasImages(content) {
  return Array.isArray(content) && content.some(p => p.type === 'image_url');
}
```

**Anthropic Path (Claude Code)**:
```javascript
// Detect images → V2.5 description → format conversion → forward to V2.5 Pro
function anthropicHasImages(content) {
  return Array.isArray(content) && content.some(p => p.type === 'image');
}
```

## Configuration

### Proxy Configuration

Edit `proxy/server.js`:

```javascript
const PORT = 3456;                                    // Proxy port
const UPSTREAM_HOST = 'token-plan-cn.xiaomimimo.com'; // Xiaomi API
const VISION_MODEL = 'mimo-v2.5';                     // Multimodal model
```

### Claude Code Model Mapping

Claude Code uses built-in aliases (sonnet/haiku/opus) mapped to custom models:

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

### Model Variants

Control reasoning depth via model name suffix:

| Model | Description |
|-------|-------------|
| `mimo-v2.5-pro-auto-vision` | Default (no variant) |
| `mimo-v2.5-pro-auto-vision-low` | Low reasoning depth |
| `mimo-v2.5-pro-auto-vision-medium` | Medium reasoning depth |
| `mimo-v2.5-pro-auto-vision-high` | High reasoning depth |
| `mimo-v2.5-pro-auto-vision-max` | Maximum reasoning depth |

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
- OpenCode: Confirm "MiMo V2.5 Pro (Auto Vision)" is selected
- Claude Code: Confirm `ANTHROPIC_BASE_URL` points to `http://127.0.0.1:3456`

**Model not available?**
- Claude Code: Use `/model` to select `sonnet` (displays as MiMo V2.5 Pro)
- Confirm `ANTHROPIC_DEFAULT_SONNET_MODEL` is set

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
