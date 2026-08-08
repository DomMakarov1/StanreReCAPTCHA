'use strict';

const { cleanAnswer } = require('./answer');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

/** Ask a model for the thing connecting two words. Returns { answer, ms, raw }. */
async function relate(model, a, b, { signal } = {}) {
  const started = Date.now();

  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      // The Modelfile carries the system prompt and few-shot examples, so the
      // request only needs the pair itself.
      messages: [{ role: 'user', content: `${a}, ${b}` }],
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

/** Model names known to Ollama, newest first. */
async function listModels() {
  const res = await fetch(`${OLLAMA_HOST}/api/tags`);
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const body = await res.json();
  return (body.models || []).map((m) => m.name);
}

module.exports = { relate, listModels, OLLAMA_HOST };
