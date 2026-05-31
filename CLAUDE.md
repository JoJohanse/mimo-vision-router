# MiMo Vision Router

MiMo V2.5 Pro Auto-Vision proxy for AI coding assistants (OpenCode, Claude Code, etc.).

## How It Works

```
AI Assistant → localhost:3456 (proxy)
  → Detects images in request
  → Calls mimo-v2.5 (multimodal) to describe images
  → Replaces images with text descriptions
  → Forwards to mimo-v2.5-pro (text-only)
  → Returns response
```

## Project Structure

- `proxy/server.js` — HTTP proxy server (port 3456)
- `proxy/mcp-launcher.js` — MCP lifecycle manager for OpenCode auto-start
- `proxy/start.ps1` — Manual proxy management script
- `setup.ps1` — One-click installer for OpenCode

## For Claude Code Users

Claude Code doesn't use OpenCode's MCP config, so start the proxy manually:

```powershell
# Start proxy
node proxy/server.js

# Or use the management script
.\proxy\start.ps1 start
```

Then configure Claude Code to use `http://127.0.0.1:3456/v1` as the API base URL with your MiMo API key.

## For OpenCode Users

Run `.\setup.ps1` to auto-configure everything (provider, MCP, agent models).

## Configuration

Edit `proxy/server.js` top constants:

| Constant | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Proxy listen port |
| `UPSTREAM_HOST` | `token-plan-cn.xiaomimimo.com` | Xiaomi API endpoint |
| `VISION_MODEL` | `mimo-v2.5` | Multimodal model for image description |
