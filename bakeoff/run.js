#!/usr/bin/env node
'use strict';

// Runs every test pair against every `relate-*` model and reports how they did.
//
//   npm run bakeoff                       # all relate-* models
//   npm run bakeoff -- relate-qwen3-8b    # just one
//
// The score is a signal, not a verdict: word association has many valid answers
// and testpairs.json only lists the ones we thought of. Read the MISSES section
// — a "wrong" answer that's actually good means the test set needs the entry,
// not that the model failed.

const fs = require('fs');
const path = require('path');

const { relate, listModels, OLLAMA_HOST } = require('../lib/ollama');
const { isMatch } = require('../lib/answer');

const PAIRS = JSON.parse(fs.readFileSync(path.join(__dirname, 'testpairs.json'), 'utf8'));

const pct = (hit, total) => (total ? `${Math.round((hit / total) * 100)}%` : '—');

async function scoreModel(model) {
  const results = [];
  for (const pair of PAIRS) {
    try {
      const { answer, ms } = await relate(model, pair.a, pair.b);
      results.push({ ...pair, answer, ms, hit: isMatch(answer, pair.accept) });
    } catch (err) {
      results.push({ ...pair, answer: `<error: ${err.message}>`, ms: 0, hit: false });
    }
    process.stdout.write('.');
  }
  process.stdout.write('\n');
  return results;
}

function report(byModel) {
  const categories = [...new Set(PAIRS.map((p) => p.category))];
  const models = Object.keys(byModel);
  const width = Math.max(20, ...models.map((m) => m.length + 2));

  const header = ['model'.padEnd(width), 'overall'.padStart(8), ...categories.map((c) => c.padStart(10)), 'median ms'.padStart(10)];
  console.log(`\n${header.join('')}`);
  console.log('-'.repeat(header.join('').length));

  for (const model of models) {
    const rows = byModel[model];
    const hits = rows.filter((r) => r.hit).length;
    const times = rows.map((r) => r.ms).filter(Boolean).sort((x, y) => x - y);
    const median = times.length ? times[Math.floor(times.length / 2)] : 0;

    const cells = categories.map((c) => {
      const inCat = rows.filter((r) => r.category === c);
      return pct(inCat.filter((r) => r.hit).length, inCat.length).padStart(10);
    });

    console.log(
      [model.padEnd(width), pct(hits, rows.length).padStart(8), ...cells, String(median).padStart(10)].join('')
    );
  }

  for (const model of models) {
    const misses = byModel[model].filter((r) => !r.hit);
    if (!misses.length) continue;
    console.log(`\nMISSES — ${model}`);
    for (const m of misses) {
      console.log(`  ${`${m.a} + ${m.b}`.padEnd(28)} got: ${(m.answer || '<empty>').padEnd(34)} want: ${m.accept[0]}`);
    }
  }
}

async function main() {
  let models = process.argv.slice(2);
  if (!models.length) {
    try {
      models = (await listModels()).filter((n) => n.startsWith('relate-'));
    } catch {
      console.error(`Can't reach Ollama at ${OLLAMA_HOST}. Is it running?`);
      process.exitCode = 1;
      return;
    }
    if (!models.length) {
      console.error('No relate-* models found. Run `npm run build-models` first.');
      process.exitCode = 1;
      return;
    }
  }

  const byModel = {};
  for (const model of models) {
    process.stdout.write(`\n${model} — ${PAIRS.length} pairs\n`);
    byModel[model] = await scoreModel(model);
  }

  report(byModel);

  const outFile = path.join(__dirname, `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify(byModel, null, 2));
  console.log(`\nFull results: ${path.relative(process.cwd(), outFile)}`);
}

main();
