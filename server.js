#!/usr/bin/env node
'use strict';

// Serves the page AND proxies to Ollama from the same origin. That second part
// is the point: if the browser called Ollama directly it would need
// OLLAMA_ORIGINS set on every machine that runs this. Going through here means
// same-origin requests and no browser-side setup at all.

const http = require('http');
const fs = require('fs');
const path = require('path');

const { relate, listModels, OLLAMA_HOST } = require('./lib/ollama');

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_MODEL = process.env.RELATE_MODEL || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limitBytes = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleRelate(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)) || '{}');
  } catch {
    return sendJson(res, 400, { error: 'invalid JSON' });
  }

  const a = String(payload.a || '').trim().slice(0, 80);
  const b = String(payload.b || '').trim().slice(0, 80);
  if (!a || !b) return sendJson(res, 400, { error: 'need two words' });

  const model = String(payload.model || DEFAULT_MODEL || '').trim();
  if (!model) return sendJson(res, 400, { error: 'no model selected' });

  try {
    const { answer, ms } = await relate(model, a, b);
    // An empty answer means the model replied with only whitespace or only
    // reasoning we stripped — surface it rather than showing a blank card.
    if (!answer) return sendJson(res, 502, { error: 'model returned nothing usable' });
    return sendJson(res, 200, { answer, ms, model });
  } catch (err) {
    return sendJson(res, 502, { error: err.message });
  }
}

async function handleModels(res) {
  try {
    const all = await listModels();
    const relateModels = all.filter((n) => n.startsWith('relate-'));
    // Prefer purpose-built models, but don't hide everything else — a bare base
    // model still works, just without the system prompt or few-shot examples.
    return sendJson(res, 200, { models: relateModels.length ? relateModels : all, tuned: relateModels.length > 0 });
  } catch {
    return sendJson(res, 502, { error: `can't reach Ollama at ${OLLAMA_HOST}`, models: [] });
  }
}

function serveStatic(req, res) {
  const rel = req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const target = path.join(PUBLIC_DIR, rel);

  // Never serve outside public/, whatever the URL claims.
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/relate') return handleRelate(req, res);
  if (req.method === 'GET' && req.url === '/api/models') return handleModels(res);
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405).end('method not allowed');
});

server.listen(PORT, () => {
  console.log(`wordbridge  →  http://localhost:${PORT}`);
  console.log(`ollama      →  ${OLLAMA_HOST}`);
});
