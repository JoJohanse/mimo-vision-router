/**
 * MiMo Proxy MCP Launcher
 *
 * Minimal MCP (Model Context Protocol) 服务器，负责管理 proxy 进程的生命周期。
 * 当 OpenCode 启动时自动启动本脚本 → 自动启动 proxy → OpenCode 关闭时自动清理。
 *
 * 协议: JSON-RPC 2.0 over stdio (新行分隔)
 */

const { spawn } = require('child_process');
const readline = require('readline');

const PROXY_SCRIPT = __filename.replace('mcp-launcher.js', 'server.js');
const PROXY_PORT = 3456;
const PROXY_CHECK_INTERVAL = 300; // ms between health checks

let proxyProcess = null;
let serverInfo = {
  name: 'mimo-proxy-manager',
  version: '1.0.0',
};

// ─── 代理生命周期 ────────────────────────────────────────────

/** 检查代理是否在监听的 Promise */
function checkProxyAlive() {
  const http = require('http');
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PROXY_PORT}/health`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** 启动代理（如果尚未运行） */
async function ensureProxyRunning() {
  const alive = await checkProxyAlive();
  if (alive) {
    log('[launcher] Proxy already running');
    return true;
  }

  log('[launcher] Starting proxy...');
  proxyProcess = spawn('node', [PROXY_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    windowsHide: true,
  });

  proxyProcess.stdout.on('data', (d) => log('[proxy] ' + d.toString().trim()));
  proxyProcess.stderr.on('data', (d) => log('[proxy:err] ' + d.toString().trim()));

  proxyProcess.on('exit', (code, signal) => {
    log(`[launcher] Proxy exited (code=${code}, signal=${signal})`);
    proxyProcess = null;
  });

  proxyProcess.on('error', (err) => {
    log(`[launcher] Proxy failed: ${err.message}`);
    proxyProcess = null;
  });

  // 轮询等待代理就绪
  for (let i = 0; i < 20; i++) {
    await sleep(PROXY_CHECK_INTERVAL);
    if (await checkProxyAlive()) {
      log('[launcher] Proxy is ready');
      return true;
    }
  }

  log('[launcher] Proxy failed to start within timeout');
  return false;
}

/** 停止代理（Windows 上 SIGKILL 最可靠） */
function stopProxy() {
  if (proxyProcess) {
    log('[launcher] Stopping proxy...');
    try { proxyProcess.kill('SIGKILL'); } catch (e) {
      try { process.kill(proxyProcess.pid); } catch {}
    }
    proxyProcess = null;
  }
}

// ─── MCP JSON-RPC 处理 ───────────────────────────────────────

/** 发送 JSON-RPC 响应到 stdout */
function send(obj) {
  const line = JSON.stringify(obj);
  process.stdout.write(line + '\n');
}

/** 发送 JSON-RPC 错误 */
function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

/** 发送 JSON-RPC 结果 */
function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

/** 处理传入的 JSON-RPC 请求 */
async function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {
    // ── 生命周期 ──
    case 'initialize': {
      const clientVersion = params?.protocolVersion || '2025-03-26';
      // 启动代理
      const proxyReady = await ensureProxyRunning();
      sendResult(id, {
        protocolVersion: clientVersion,
        capabilities: {
          tools: {}, // 声明支持 tools
        },
        serverInfo,
      });
      break;
    }

    case 'notifications/initialized': {
      // OpenCode 通知初始化完成，忽略
      break;
    }

    // ── Tools ──
    case 'tools/list': {
      sendResult(id, {
        tools: [
          {
            name: 'proxy_status',
            description: 'Check if the MiMo Vision Proxy is running and get its status',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      });
      break;
    }

    case 'tools/call': {
      const { name, arguments: args } = params || {};
      if (name === 'proxy_status') {
        const alive = await checkProxyAlive();
        sendResult(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                running: alive,
                port: PROXY_PORT,
                pid: proxyProcess ? proxyProcess.pid : null,
                endpoint: `http://127.0.0.1:${PROXY_PORT}/v1/chat/completions`,
              }),
            },
          ],
        });
      } else {
        sendError(id, -32601, `Tool not found: ${name}`);
      }
      break;
    }

    // ── 结束 ──
    case 'shutdown':
    case 'exit': {
      stopProxy();
      sendResult(id, null);
      process.exit(0);
      break;
    }

    default:
      sendError(id, -32601, `Method not found: ${method}`);
  }
}

// ─── 入口 ────────────────────────────────────────────────────

function log(msg) {
  // MCP 协议使用 stderr 做日志，stdout 只传 JSON-RPC
  process.stderr.write(msg + '\n');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 用 readline 逐行读取 stdin
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout, // 我们只用 stdout 发 JSON-RPC
  terminal: false,
});

rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;
  try {
    const msg = JSON.parse(line);
    await handleRequest(msg);
  } catch (err) {
    log(`[launcher] Parse error: ${err.message} | raw: ${line}`);
    // 无法解析的行忽略（可能是不完整的消息）
  }
});

rl.on('close', () => {
  log('[launcher] stdin closed, cleaning up...');
  stopProxy();
  process.exit(0);
});

// 无论什么原因退出都清理子进程
process.on('exit', () => {
  if (proxyProcess) {
    try { proxyProcess.kill('SIGKILL'); } catch {}
    proxyProcess = null;
  }
});

process.on('SIGTERM', () => {
  log('[launcher] Received SIGTERM');
  process.exit(0); // exit handler 会自动清理
});

process.on('SIGINT', () => {
  log('[launcher] Received SIGINT');
  process.exit(0);
});

log('[launcher] MCP launcher ready, waiting for initialize...');
