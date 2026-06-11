/**
 * MiMo Vision Proxy
 *
 * 支持 OpenAI 和 Anthropic 两种 API 格式，完全独立处理：
 * - OpenAI 路径:   POST /v1/chat/completions → v2.5(OpenAI) → v2.5-pro(OpenAI)
 * - Anthropic 路径: POST /v1/messages → v2.5(Anthropic) → v2.5-pro(Anthropic)
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');

const PORT = 3456;
const UPSTREAM_HOST = 'token-plan-cn.xiaomimimo.com';
const VISION_MODEL = 'mimo-v2.5';

// ─── 模型变体配置 ──────────────────────────────────────────────
// 变体控制思考深度 (reasoning_effort)
// OpenCode 对 @ai-sdk/openai-compatible 使用 reasoning_effort 参数
const SUPPORTED_VARIANTS = ['low', 'medium', 'high', 'max'];

/** 解析模型名，返回 { upstreamModel, variant } */
function resolveModelVariant(requestedModel) {
  const lower = (requestedModel || '').toLowerCase();
  // 匹配 mimo-v2.5-pro-auto-vision-{variant} 或 mimo-v2.5-pro-{variant}
  const match = lower.match(/^mimo-v2\.5-pro(?:-auto-vision)?-(low|medium|high|max)$/);
  if (match) {
    return { upstreamModel: 'mimo-v2.5-pro', variant: match[1] };
  }
  // 无变体的默认模型
  return { upstreamModel: 'mimo-v2.5-pro', variant: null };
}

// ─── 通用工具 ────────────────────────────────────────────────

function extractApiKey(headers) {
  // 支持 Authorization: Bearer xxx (OpenAI) 和 x-api-key: xxx (Anthropic/Claude Code)
  const xKey = headers['x-api-key'] || '';
  if (xKey) return xKey.trim();
  const auth = headers['authorization'] || headers['Authorization'] || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

function httpsRequest(path, bodyJson, apiKey) {
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

function httpsStream(path, bodyJson, apiKey) {
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

// ═══════════════════════════════════════════════════════════════
// OpenAI 路径 (完全独立)
// ═══════════════════════════════════════════════════════════════

function openaiHasImages(content) {
  return Array.isArray(content) && content.some(p => p.type === 'image_url');
}

/** 用 v2.5 描述图片 (OpenAI 格式调用) */
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
    const result = await httpsRequest('/chat/completions', {
      model: VISION_MODEL,
      messages: [{ role: 'user', content: visionContent }],
      max_tokens: 4096,
      stream: false,
    }, apiKey);

    if (result.statusCode !== 200) return '';
    return JSON.parse(result.body).choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('[OpenAI] Vision call failed:', err.message);
    return '';
  }
}

/** 处理单条 OpenAI message */
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
    // 变体控制思考深度: reasoning_effort
    ...(variant ? { reasoning_effort: variant } : {}),
  };

  if (stream) return { mode: 'openai-stream', upstreamBody, apiKey };

  const result = await httpsRequest('/chat/completions', upstreamBody, apiKey);
  return { statusCode: result.statusCode, headers: { 'Content-Type': 'application/json' }, body: result.body };
}

/** OpenAI streaming 转发 */
function pipeOpenAIStream(upstreamBody, apiKey, res) {
  httpsStream('/chat/completions', upstreamBody, apiKey).then((upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    upstreamRes.pipe(res);
    res.on('close', () => upstreamRes.destroy());
  }).catch((err) => {
    console.error('[OpenAI] Stream error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Upstream connection failed' } }));
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// Anthropic 路径 (完全独立)
// ═══════════════════════════════════════════════════════════════

function anthropicHasImages(content) {
  return Array.isArray(content) && content.some(p => p.type === 'image');
}

/** Anthropic base64 image → data URL */
function anthropicImageToDataUrl(img) {
  const mediaType = img.source?.media_type || 'image/png';
  return `data:${mediaType};base64,${img.source.data}`;
}

/** 用 v2.5 描述图片 (Anthropic 格式调用) */
async function anthropicDescribeImages(textParts, imageParts, apiKey) {
  const visionContent = [];
  if (textParts.length > 0) {
    visionContent.push({ type: 'text', text: `User context: ${textParts.join('\n')}\n\nDescribe the image(s) in detail, including any text, code, diagrams, or visual elements.` });
  } else {
    visionContent.push({ type: 'text', text: 'Describe this image in detail, especially any text, code, diagrams, or visual elements.' });
  }
  for (const img of imageParts) {
    visionContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.source.media_type || 'image/png',
        data: img.source.data,
      },
    });
  }

  // 转为 OpenAI 格式调用 v2.5 (上游只支持 OpenAI)
  const openaiContent = visionContent.map(p => {
    if (p.type === 'text') return { type: 'text', text: p.text };
    if (p.type === 'image') return { type: 'image_url', image_url: { url: anthropicImageToDataUrl(p) } };
    return p;
  });

  try {
    const result = await httpsRequest('/chat/completions', {
      model: VISION_MODEL,
      messages: [{ role: 'user', content: openaiContent }],
      max_tokens: 4096,
      stream: false,
    }, apiKey);

    if (result.statusCode !== 200) return '';
    return JSON.parse(result.body).choices?.[0]?.message?.content || '';
  } catch (err) {
    console.error('[Anthropic] Vision call failed:', err.message);
    return '';
  }
}

/** 处理单条 Anthropic message */
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

/** Anthropic → OpenAI 请求转换 (用于转发到上游) */
function anthropicToOpenAI(body) {
  const messages = [];
  if (body.system) messages.push({ role: 'system', content: body.system });

  for (const msg of body.messages || []) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      const openaiContent = [];
      for (const part of msg.content) {
        if (part.type === 'text') {
          openaiContent.push({ type: 'text', text: part.text });
        } else if (part.type === 'image') {
          openaiContent.push({ type: 'image_url', image_url: { url: anthropicImageToDataUrl(part) } });
        }
      }
      messages.push({ role: msg.role, content: openaiContent });
    }
  }

  return {
    model: body.model,
    messages,
    max_tokens: body.max_tokens || 4096,
    temperature: body.temperature,
    top_p: body.top_p,
    stream: body.stream || false,
  };
}

/** OpenAI → Anthropic 响应转换 */
function openAIToAnthropicResponse(openaiResp) {
  const choice = openaiResp.choices?.[0];
  return {
    id: `msg_${crypto.randomBytes(12).toString('hex')}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: choice?.message?.content || '' }],
    model: openaiResp.model || 'mimo-v2.5-pro',
    stop_reason: choice?.finish_reason === 'stop' ? 'end_turn' : choice?.finish_reason || 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: openaiResp.usage?.prompt_tokens || 0,
      output_tokens: openaiResp.usage?.completion_tokens || 0,
    },
  };
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

  // Step 1: 处理 Anthropic 格式的图片
  const processedMessages = await anthropicProcessMessages(body.messages || [], apiKey);

  // Step 2: 转换为 OpenAI 格式用于转发
  const openaiBody = anthropicToOpenAI({ ...body, messages: processedMessages });
  const { upstreamModel, variant } = resolveModelVariant(body.model);
  openaiBody.model = upstreamModel;
  // 变体控制思考深度: reasoning_effort
  if (variant) {
    openaiBody.reasoning_effort = variant;
  }

  if (body.stream) return { mode: 'anthropic-stream', upstreamBody: openaiBody, apiKey };

  // Step 3: 非 streaming: 调用上游，转换响应
  const result = await httpsRequest('/chat/completions', openaiBody, apiKey);
  if (result.statusCode !== 200) {
    return { statusCode: result.statusCode, headers: { 'Content-Type': 'application/json' }, body: result.body };
  }

  const anthropicResp = openAIToAnthropicResponse(JSON.parse(result.body));
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(anthropicResp) };
}

/** Anthropic streaming: OpenAI SSE → Anthropic SSE */
function pipeAnthropicStream(upstreamBody, apiKey, res) {
  const anthropicModel = upstreamBody.model || 'mimo-v2.5-pro';

  httpsStream('/chat/completions', upstreamBody, apiKey).then((upstreamRes) => {
    if (upstreamRes.statusCode !== 200) {
      res.writeHead(upstreamRes.statusCode, { 'Content-Type': 'application/json' });
      upstreamRes.pipe(res);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });

    const msgId = `msg_${crypto.randomBytes(12).toString('hex')}`;
    let started = false;
    let buffer = '';
    let blockIndex = 0;

    res.write(`event: message_start\ndata: ${JSON.stringify({
      type: 'message_start',
      message: { id: msgId, type: 'message', role: 'assistant', content: [], model: anthropicModel, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
    })}\n\n`);

    upstreamRes.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);
        if (dataStr === '[DONE]') {
          if (!res.writableEnded) {
            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: blockIndex })}\n\n`);
            res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } })}\n\n`);
            res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
            res.end();
          }
          return;
        }

        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          if (!started) {
            started = true;
            res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } })}\n\n`);
          }

          if (delta.content) {
            res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text: delta.content } })}\n\n`);
          }
        } catch {}
      }
    });

    upstreamRes.on('end', () => {
      if (!res.writableEnded) {
        if (!started) {
          res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } })}\n\n`);
        }
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: blockIndex })}\n\n`);
        res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
        res.end();
      }
    });

    upstreamRes.on('error', (err) => {
      console.error('[Anthropic] Stream error:', err.message);
      if (!res.writableEnded) res.end();
    });

    res.on('close', () => upstreamRes.destroy());
  }).catch((err) => {
    console.error('[Anthropic] Stream init error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Upstream connection failed' } }));
  });
}

// ─── HTTP 服务器 ─────────────────────────────────────────────

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, anthropic-version, x-api-key');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  // POST /v1/chat/completions (OpenAI)
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const result = await handleOpenAI(parsed, req.headers);
        if (result.mode === 'openai-stream') { pipeOpenAIStream(result.upstreamBody, result.apiKey, res); return; }
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

  // POST /v1/messages (Anthropic)
  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const result = await handleAnthropic(parsed, req.headers);
        if (result.mode === 'anthropic-stream') { pipeAnthropicStream(result.upstreamBody, result.apiKey, res); return; }
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

  // GET /v1/models
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: [
        { id: 'mimo-v2.5-pro-auto-vision',          object: 'model', owned_by: 'xiaomi' },
        { id: 'mimo-v2.5-pro-auto-vision-low',      object: 'model', owned_by: 'xiaomi' },
        { id: 'mimo-v2.5-pro-auto-vision-medium',   object: 'model', owned_by: 'xiaomi' },
        { id: 'mimo-v2.5-pro-auto-vision-high',     object: 'model', owned_by: 'xiaomi' },
        { id: 'mimo-v2.5-pro-auto-vision-max',      object: 'model', owned_by: 'xiaomi' },
      ],
    }));
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 MiMo Vision Proxy running on http://127.0.0.1:${PORT}`);
  console.log(`   Upstream: https://${UPSTREAM_HOST}/v1`);
  console.log(`   OpenAI:    POST /v1/chat/completions`);
  console.log(`   Anthropic: POST /v1/messages`);
  console.log(`   Vision:    ${VISION_MODEL} → Text: mimo-v2.5-pro`);
});

process.on('SIGINT', () => { console.log('\nShutting down...'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => server.close(() => process.exit(0)));
