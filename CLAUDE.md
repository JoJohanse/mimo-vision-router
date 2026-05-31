# MiMo Vision Router

MiMo V2.5 Pro Auto-Vision proxy for AI coding assistants.

## Quick Start

### Claude Code (One-Click)

```powershell
.\setup-claude.ps1
```

This will:
- Install proxy to `~/.config/mimo-vision-router/`
- Create `start-claude.ps1` launcher
- Create `claude.cmd` quick command

Then use:
```powershell
# Option 1: Launcher (auto-starts proxy)
.\start-claude.ps1

# Option 2: Quick command
claude.cmd

# Option 3: Manual
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:3456"
$env:ANTHROPIC_API_KEY = "your-api-key"
claude
```

### OpenCode (One-Click)

```powershell
.\setup.ps1
```

## How It Works

```
AI Assistant → localhost:3456 (proxy)
  → Detects images in request
  → Calls mimo-v2.5 (multimodal) to describe images
  → Replaces images with text descriptions
  → Forwards to mimo-v2.5-pro (text-only)
  → Returns response
```

## API Compatibility

| Client | Endpoint | Format |
|--------|----------|--------|
| OpenCode | `POST /v1/chat/completions` | OpenAI |
| Claude Code | `POST /v1/messages` | Anthropic |

## Configuration

Edit `proxy/server.js` constants:

| Constant | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Proxy listen port |
| `UPSTREAM_HOST` | `token-plan-cn.xiaomimimo.com` | Xiaomi API endpoint |
| `VISION_MODEL` | `mimo-v2.5` | Multimodal model for image description |

## Troubleshooting

```powershell
# Check proxy status
curl http://127.0.0.1:3456/health

# Check if port is in use
netstat -ano | findstr :3456

# Start proxy manually
node proxy/server.js
```
