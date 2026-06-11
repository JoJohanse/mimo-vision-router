/**
 * MiMo Vision Proxy
 *
 * 两条完全独立的路径：
 *
 * OpenAI 路径 (OpenCode):
 *   POST /v1/chat/completions → mimo-v2.5(OpenAI) 描述图片 → mimo-v2.5-pro(OpenAI)
 *
 * Anthropic 路径 (Claude Code):
 *   POST /v1/messages → mimo-v2.5(Anthropic) 描述图片 → mimo-v2.5-pro(Anthropic)
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = 3456;
const UPSTREAM_HOST = 'token-plan-cn.xiaomimimo.com';
const VISION_MODEL = 'mimo-v2.5';

// ─── 模型变体配置 ──────────────────────────────────────────────
const SUPPORTED_VARIANTS = ['low', 'medium', 'high'];

function resolveModelVariant(requestedModel) {
  const lower = (requestedModel || '').toLowerCase();
  // mimo-v2.5-pro-auto-version-{variant} 或 mimo-v2.5-pro-{variant}
  const match = lower.match(/^mimo-v2\.5-pro(?:-auto-version)?-(low|medium|high)$/);
  if (match) return { upstreamModel: 'mimo-v2.5-pro', variant: match[1] };
  // mimo-v2.5-pro-auto-version → mimo-v2.5-pro
  if (lower.startsWith('mimo-v2.5-pro')) return { upstreamModel: 'mimo-v2.5-pro', variant: null };
  // haiku 等其他模型直接透传
  return { upstreamModel: requestedModel, variant: null };
}

// ─── 通用工具 ────────────────────────────────────────────────

function extractApiKey(headers) {
  const xKey = headers['x-api-key'] || '';
  if (xKey) return xKey.trim();
  const auth = headers['authorization'] || headers['Authorization'] || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

// ─── OpenAI 格式 HTTPS ────────────────────────────────────────

function openaiHttpsRequest(path, bodyJson, apiKey) {
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
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function openaiHttpsStream(path, bodyJson, apiKey) {
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
    const req = https.request(options, (res) => resolve(res));
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ─── Anthropic 格式 HTTPS ──────────────────────────────────────

function anthropicHttpsRequest(path, bodyJson, apiKey) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyJson);
    const options = {
      hostname: UPSTREAM_HOST,
      path: `/anthropic/v1${path}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function anthropicHttpsStream(path, bodyJson, apiKey) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyJson);
    const options = {
      hostname: UPSTREAM_HOST,
      path: `/anthropic/v1${path}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, (res) => resolve(res));
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════
// OpenAI 路径 (完全独立，给 OpenCode 用)
// ═══════════════════════════════════════════════════════════════

function openaiHasImages(content) {
  return Array.isArray(content) && content.some(p => p.type === 'image_url');
}

/** 用 v2.5 描述图片 (OpenAI 格式) */
async function openaiDescribeImages(textParts, imageUrls, apiKey) {
  const visionContent = [];
  if (textParts.length > 0) {
    visionContent.push({ type: 'text', text: `User context: ${textParts.join('\n')}\n\nDescribe the image(s) in detail, including any text, code, diagrams, or visual elements.` });
  } else {
    visionContent.push({ type: 'text', text: 'Describe this image in detail, especially any text, code, diagrams, or visual elements.' });
  }
  for (const url of imageUrls) {
    visionContent.push({ type: 'image_url', image_url: { url } });
  }

  try {
    const result = await openaiHttpsRequest('/chat/completions', {
      model: VISION_MODEL,
      messages: [{ role: 'user', content: visionContent }],
      max_tokens: 4096,
      stream: false,
    }, apiKey);

    if (result.statusCode !== 200) return '';
    return JSON.parse(result.body).choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('[OpenAI-Vision] Call failed:', err.message);
    return '';
  }
}

async function openaiProcessMessage(msg, apiKey) {
  if (!openaiHasImages(msg.content)) return msg;

  const textParts = [];
  const imageUrls = [];
  for (const part of msg.content) {
    if (part.type === 'text') textParts.push(part.text);
    else if (part.type === 'image_url') imageUrls.push(part.image_url.url);
  }

  const description = await openaiDescribeImages(textParts, imageUrls, apiKey);
  const newContent = [...textParts];
  newContent.push(description ? `[Image: ${description}]` : '[Image]');
  return { ...msg, content: newContent.join('\n') };
}

async function openaiProcessMessages(messages, apiKey) {
  const processed = [];
  for (const msg of messages) processed.push(await openaiProcessMessage(msg, apiKey));
  return processed;
}

/** 处理 OpenAI 请求 */
async function handleOpenAI(body, headers) {
  const apiKey = extractApiKey(headers);
  if (!apiKey) return { statusCode: 401, body: JSON.stringify({ error: { message: 'Missing API key' } }) };

  const { messages, stream, ...rest } = body;
  const processedMessages = await openaiProcessMessages(messages || [], apiKey);
  const { upstreamModel, variant } = resolveModelVariant(body.model);
  const upstreamBody = {
    ...rest,
    messages: processedMessages,
    model: upstreamModel,
    stream,
    ...(variant ? { reasoning_effort: variant } : {}),
  };

  if (stream) return { mode: 'openai-stream', upstreamBody, apiKey, requestedModel: body.model };

  const result = await openaiHttpsRequest('/chat/completions', upstreamBody, apiKey);
  if (result.statusCode === 200) {
    try {
      const resp = JSON.parse(result.body);
      resp.model = body.model;
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resp) };
    } catch {}
  }
  return { statusCode: result.statusCode, headers: { 'Content-Type': 'application/json' }, body: result.body };
}

/** OpenAI streaming 转发 */
function pipeOpenAIStream(upstreamBody, apiKey, res, requestedModel) {
  openaiHttpsStream('/chat/completions', upstreamBody, apiKey).then((upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    if (!requestedModel) {
      upstreamRes.pipe(res);
      res.on('close', () => upstreamRes.destroy());
      return;
    }

    let buffer = '';
    upstreamRes.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const parsed = JSON.parse(line.slice(6));
            parsed.model = requestedModel;
            res.write(`data: ${JSON.stringify(parsed)}\n\n`);
          } catch {
            res.write(line + '\n');
          }
        } else {
          res.write(line + '\n');
        }
      }
    });

    upstreamRes.on('end', () => {
      if (buffer) res.write(buffer);
      res.end();
    });

    upstreamRes.on('error', (err) => {
      console.error('[OpenAI-Stream] Error:', err.message);
      if (!res.writableEnded) res.end();
    });

    res.on('close', () => upstreamRes.destroy());
  }).catch((err) => {
    console.error('[OpenAI-Stream] Init error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Upstream connection failed' } }));
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// Anthropic 路径 (完全独立，给 Claude Code 用)
// ═══════════════════════════════════════════════════════════════

function anthropicHasImages(content) {
  return Array.isArray(content) && content.some(p => p.type === 'image');
}

/** 用 v2.5 描述图片 (Anthropic 格式) */
async function anthropicDescribeImages(textParts, imageParts, apiKey) {
  const content = [];
  if (textParts.length > 0) {
    content.push({ type: 'text', text: `User context: ${textParts.join('\n')}\n\nDescribe the image(s) in detail, including any text, code, diagrams, or visual elements.` });
  } else {
    content.push({ type: 'text', text: 'Describe this image in detail, especially any text, code, diagrams, or visual elements.' });
  }
  for (const img of imageParts) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.source.media_type || 'image/png', data: img.source.data },
    });
  }

  try {
    const result = await anthropicHttpsRequest('/messages', {
      model: VISION_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content }],
    }, apiKey);

    if (result.statusCode !== 200) {
      console.error('[Anthropic-Vision] Upstream error:', result.statusCode);
      return '';
    }
    const resp = JSON.parse(result.body);
    return resp.content?.map(p => p.text).join('') || '';
  } catch (err) {
    console.error('[Anthropic-Vision] Call failed:', err.message);
    return '';
  }
}

async function anthropicProcessMessage(msg, apiKey) {
  if (!anthropicHasImages(msg.content)) return msg;

  const textParts = [];
  const imageParts = [];
  for (const part of msg.content) {
    if (part.type === 'text') textParts.push(part.text);
    else if (part.type === 'image') imageParts.push(part);
  }

  const description = await anthropicDescribeImages(textParts, imageParts, apiKey);
  const newContent = textParts.map(t => ({ type: 'text', text: t }));
  newContent.push({ type: 'text', text: description ? `[Image: ${description}]` : '[Image]' });
  return { ...msg, content: newContent };
}

async function anthropicProcessMessages(messages, apiKey) {
  const processed = [];
  for (const msg of messages) processed.push(await anthropicProcessMessage(msg, apiKey));
  return processed;
}

/** 处理 Anthropic 请求 */
async function handleAnthropic(body, headers) {
  const apiKey = extractApiKey(headers);
  if (!apiKey) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Missing API key' } }),
    };
  }

  // 处理图片
  const processedMessages = await anthropicProcessMessages(body.messages || [], apiKey);

  // 映射模型名 (mimo-v2.5-pro-auto-version → mimo-v2.5-pro)
  const { upstreamModel, variant } = resolveModelVariant(body.model);
  const upstreamBody = { ...body, messages: processedMessages, model: upstreamModel };
  if (variant) upstreamBody.reasoning_effort = variant;

  if (body.stream) return { mode: 'anthropic-stream', upstreamBody, apiKey, requestedModel: body.model };

  const result = await anthropicHttpsRequest('/messages', upstreamBody, apiKey);
  // 非 streaming: 替换响应中的 model 为请求的模型名
  if (result.statusCode === 200) {
    try {
      const resp = JSON.parse(result.body);
      resp.model = body.model;
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resp) };
    } catch {}
  }
  return { statusCode: result.statusCode, headers: { 'Content-Type': 'application/json' }, body: result.body };
}

/** Anthropic streaming 直通 (替换响应中的 model) */
function pipeAnthropicStream(upstreamBody, apiKey, res, requestedModel) {
  anthropicHttpsStream('/messages', upstreamBody, apiKey).then((upstreamRes) => {
    if (upstreamRes.statusCode !== 200) {
      res.writeHead(upstreamRes.statusCode, { 'Content-Type': 'application/json' });
      upstreamRes.pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    if (!requestedModel) {
      upstreamRes.pipe(res);
      res.on('close', () => upstreamRes.destroy());
      return;
    }

    let buffer = '';
    upstreamRes.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.model) parsed.model = requestedModel;
            res.write(`data: ${JSON.stringify(parsed)}\n\n`);
          } catch {
            res.write(line + '\n');
          }
        } else {
          res.write(line + '\n');
        }
      }
    });

    upstreamRes.on('end', () => {
      if (buffer) res.write(buffer);
      res.end();
    });

    upstreamRes.on('error', (err) => {
      console.error('[Anthropic-Stream] Error:', err.message);
      if (!res.writableEnded) res.end();
    });

    res.on('close', () => upstreamRes.destroy());
  }).catch((err) => {
    console.error('[Anthropic-Stream] Error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Upstream connection failed' } }));
    }
  });
}

// ─── HTTP 服务器 ─────────────────────────────────────────────

const server = http.createServer((req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, anthropic-version, x-api-key');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // POST /v1/chat/completions (OpenAI → 小米 OpenAI)
  if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const result = await handleOpenAI(parsed, req.headers);
        if (result.mode === 'openai-stream') { pipeOpenAIStream(result.upstreamBody, result.apiKey, res, result.requestedModel); return; }
        res.writeHead(result.statusCode, result.headers || { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch (err) {
        console.error('[OpenAI] Error:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message } }));
      }
    });
    return;
  }

  // POST /v1/messages (Anthropic → 小米 Anthropic)
  if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const result = await handleAnthropic(parsed, req.headers);
        if (result.mode === 'anthropic-stream') { pipeAnthropicStream(result.upstreamBody, result.apiKey, res, result.requestedModel); return; }
        res.writeHead(result.statusCode, result.headers || { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch (err) {
        console.error('[Anthropic] Error:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: err.message } }));
      }
    });
    return;
  }

  // GET /health
  if (req.method === 'GET' && ['/', '/health'].includes(req.url)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', proxy: 'mimo-vision-proxy', supported_apis: ['openai', 'anthropic'] }));
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 MiMo Vision Proxy running on http://127.0.0.1:${PORT}`);
  console.log(`   OpenAI:    POST /v1/chat/completions → /v1/chat/completions`);
  console.log(`   Anthropic: POST /v1/messages → /anthropic/v1/messages`);
  console.log(`   Vision:    ${VISION_MODEL} → Text: mimo-v2.5-pro`);
});

process.on('SIGINT', () => { console.log('\nShutting down...'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => server.close(() => process.exit(0)));
