'use strict';

const { cleanAnswer, parsePair } = require('./answer');
const { buildMessages, buildReverseMessages, OPTIONS } = require('./prompt');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

// Node's fetch reports every transport failure as the bare string "fetch
// failed", with the real cause buried in err.cause. Unwrap it — a stopped
// service is by far the most common failure here and deserves to say so.
const DOWN_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'UND_ERR_SOCKET']);

async function fetchOllama(pathname, init) {
  try {
    return await fetch(`${OLLAMA_HOST}${pathname}`, init);
  } catch (err) {
    const code = err && err.cause && err.cause.code;
    if (DOWN_CODES.has(code) || err.name === 'TimeoutError') {
      throw new Error(
        `Ollama is not responding at ${OLLAMA_HOST} — start it with \`ollama serve\``
      );
    }
    throw err;
  }
}

/** Ask a model for the thing connecting two words. Returns { answer, ms, raw }. */
async function relate(model, a, b, { signal } = {}) {
  const started = Date.now();

  const res = await fetchOllama('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      // System prompt and few-shot examples ride along with every request, so
      // this works against a plain base model — no `ollama create` needed.
      messages: buildMessages(a, b),
      options: OPTIONS,
      stream: false,
      // Hybrid-reasoning models default to thinking, which costs seconds and
      // pollutes the reply. cleanAnswer() strips any that leaks through anyway.
      think: false,
      // Keep the weights resident so the second question isn't a cold start.
      keep_alive: '10m',
    }),
  });

  if (!res.ok) {
    throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const body = await res.json();
  const raw = (body.message && body.message.content) || '';
  return { answer: cleanAnswer(raw), raw, ms: Date.now() - started };
}

/** Split one thing into the two words that would produce it. { a, b, ms, raw }. */
async function reverse(model, thing, { signal } = {}) {
  const started = Date.now();

  const res = await fetchOllama('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      messages: buildReverseMessages(thing),
      options: OPTIONS,
      stream: false,
      think: false,
      keep_alive: '10m',
    }),
  });

  if (!res.ok) {
    throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const body = await res.json();
  const raw = (body.message && body.message.content) || '';
  const pair = parsePair(raw);
  if (!pair) throw new Error(`model did not return two words: "${cleanAnswer(raw)}"`);

  return { ...pair, raw, ms: Date.now() - started };
}

/** Model names known to Ollama, newest first. */
async function listModels() {
  const res = await fetchOllama('/api/tags');
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const body = await res.json();
  return (body.models || []).map((m) => m.name);
}

module.exports = { relate, reverse, listModels, OLLAMA_HOST };
