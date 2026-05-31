/**
 * MiMo Vision Proxy
 *
 * 拦截 OpenCode → Xiaomi API 的请求：
 * 1. 检测 messages 中是否有图片 (image_url)
 * 2. 有图片 → 调用 mimo-v2.5 (多模态) 提取图片文字描述
 * 3. 替换图片为描述文本 → 转发给 mimo-v2.5-pro（纯文本）
 * 4. 将响应原样返回（支持 streaming / non-streaming）
 *
 * 使用方式：
 *   node server.js
 *   然后在 opencode.json 中将 provider baseURL 指向 http://127.0.0.1:3456/v1
 */

const http = require('http');
const https = require('https');

const PORT = 3456;
const UPSTREAM_HOST = 'token-plan-cn.xiaomimimo.com';
const VISION_MODEL = 'mimo-v2.5';

// ─── 工具函数 ────────────────────────────────────────────────

/** 从请求头中提取 Bearer API Key */
function extractApiKey(headers) {
  const auth = headers['authorization'] || headers['Authorization'] || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

/** 判断 message content 中是否包含图片 */
function hasImages(content) {
  return Array.isArray(content) && content.some(p => p.type === 'image_url');
}

/** 发起上游 API 请求（非 streaming），返回完整 body */
function upstreamFetch(path, bodyJson, apiKey) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyJson);
    const options = {
      hostname: UPSTREAM_HOST,
      path: `/v1${path}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
        }),
      );
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

/** 用 v2.5 描述图片，返回描述文本 */
async function describeImages(textParts, imageUrls, apiKey) {
  // 构建 vision prompt
  const visionContent = [];
  if (textParts.length > 0) {
    visionContent.push({
      type: 'text',
      text: `User context: ${textParts.join('\n')}\n\nDescribe the image(s) in detail, including any text, code, diagrams, or visual elements. Extract all relevant information.`,
    });
  } else {
    visionContent.push({
      type: 'text',
      text: 'Describe this image in detail, especially any text, code, diagrams, or visual elements.',
    });
  }
  for (const url of imageUrls) {
    visionContent.push({ type: 'image_url', image_url: { url } });
  }

  try {
    const result = await upstreamFetch(
      '/chat/completions',
      {
        model: VISION_MODEL,
        messages: [{ role: 'user', content: visionContent }],
        max_tokens: 4096,
        stream: false,
      },
      apiKey,
    );

    if (result.statusCode !== 200) {
      console.warn(`[Proxy] v2.5 vision call returned ${result.statusCode}`);
      return '';
    }

    const data = JSON.parse(result.body);
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('[Proxy] v2.5 vision call failed:', err.message);
    return '';
  }
}

/** 处理单条 message：若含图片则调用 v2.5 提取描述并替换 */
async function processMessage(msg, apiKey) {
  if (!hasImages(msg.content)) return msg;

  const textParts = [];
  const imageUrls = [];

  for (const part of msg.content) {
    if (part.type === 'text') textParts.push(part.text);
    else if (part.type === 'image_url') imageUrls.push(part.image_url.url);
  }

  const description = await describeImages(textParts, imageUrls, apiKey);

  // 构造纯文本版本的 content
  const newContent = [...textParts];
  if (description) {
    newContent.push(`[Image: ${description}]`);
  } else {
    newContent.push('[Image]');
  }

  return { ...msg, content: newContent.join('\n') };
}

/** 处理 images 并返回修改后的 messages */
async function processMessages(messages, apiKey) {
  const processed = [];
  for (const msg of messages) {
    processed.push(await processMessage(msg, apiKey));
  }
  return processed;
}

// ─── 请求处理 ────────────────────────────────────────────────

async function handleRequest(parsedBody, reqHeaders) {
  const apiKey = extractApiKey(reqHeaders);
  if (!apiKey) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: 'Missing API key' } }),
    };
  }

  const { messages, stream, ...rest } = parsedBody;

  // Step 1: 处理 messages 中的图片
  const processedMessages = await processMessages(messages || [], apiKey);

  // Step 2: 转发给 mimo-v2.5-pro
  const upstreamBody = {
    ...rest,
    messages: processedMessages,
    model: 'mimo-v2.5-pro',
    stream,
  };

  if (stream) {
    return { mode: 'stream', upstreamBody, apiKey };
  }

  const result = await upstreamFetch('/chat/completions', upstreamBody, apiKey);
  let responseBody = result.body;

  // 如果上游返回错误，尝试透传
  if (result.statusCode !== 200) {
    try {
      const errData = JSON.parse(result.body);
      responseBody = JSON.stringify(errData);
    } catch {
      responseBody = result.body;
    }
  }

  return {
    statusCode: result.statusCode,
    headers: {
      'Content-Type': result.headers['content-type'] || 'application/json',
    },
    body: responseBody,
  };
}

/** 发起 streaming 请求并 pipe 到 response */
function pipeStream(upstreamBody, apiKey, res) {
  const bodyStr = JSON.stringify(upstreamBody);
  const options = {
    hostname: UPSTREAM_HOST,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(bodyStr),
    },
  };

  const upstreamReq = https.request(options, (upstreamRes) => {
    const statusCode = upstreamRes.statusCode || 200;
    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...(statusCode !== 200
        ? {}
        : { 'X-Accel-Buffering': 'no' }),
    };
    res.writeHead(statusCode, headers);
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', (err) => {
    console.error('[Proxy] Stream error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Upstream connection failed' } }));
    }
  });

  upstreamReq.write(bodyStr);
  upstreamReq.end();

  // 如果客户端断开，取消上游请求
  res.on('close', () => upstreamReq.destroy());
}

// ─── HTTP 服务器 ─────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // POST /v1/chat/completions
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const result = await handleRequest(parsed, req.headers);

        if (result.mode === 'stream') {
          pipeStream(result.upstreamBody, result.apiKey, res);
          return;
        }

        res.writeHead(result.statusCode, result.headers);
        res.end(result.body);
      } catch (err) {
        console.error('[Proxy] Request error:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message } }));
      }
    });
    return;
  }

  // GET /health
  if (req.method === 'GET' && ['/', '/health'].includes(req.url)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', proxy: 'mimo-vision-proxy' }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 MiMo Vision Proxy running on http://127.0.0.1:${PORT}`);
  console.log(`   Upstream: https://${UPSTREAM_HOST}/v1`);
  console.log(`   Vision model: ${VISION_MODEL} → Text model: mimo-v2.5-pro`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
