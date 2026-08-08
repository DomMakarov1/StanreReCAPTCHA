#!/usr/bin/env node
'use strict';

// Creates a named `relate-*` Ollama model per base, baking in the prompt from
// lib/prompt.js.
//
// This is OPTIONAL. The prompt is sent with every request anyway, so the app and
// the bake-off both work against plain base models. Use this only when you want
// a pre-configured model you can call from `ollama run` directly.
//
//   npm run build-models                    # the default line-up
//   npm run build-models -- qwen3:14b       # specific bases

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveOllama } = require('../lib/ollama-bin');
const { buildModelfile } = require('../lib/prompt');

// Spans a wide size range on purpose: the small one is the control. If it
// scores close to the 27B, size isn't buying you anything and you should keep
// the fast model. Approximate 4-bit download sizes in the comments.
const DEFAULT_BASES = [
  'qwen3:8b',          //  ~5 GB — baseline
  'gemma3:12b',        //  ~8 GB
  'mistral-small3.2',  // ~15 GB
  'gemma3:27b',        // ~17 GB
];


/** qwen3:8b -> relate-qwen3-8b */
function derivedName(base) {
  return `relate-${base.replace(/[:/]/g, '-').replace(/[^a-zA-Z0-9._-]/g, '')}`;
}

/** Model names the *server* can currently see, or null if it can't be asked. */
function localModels(ollama) {
  try {
    const out = execFileSync(ollama, ['list'], { stdio: 'pipe', encoding: 'utf8' });
    return out
      .split('\n')
      .slice(1) // header row
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * "pull model manifest: file does not exist" is ambiguous — it covers a typo in
 * the model name AND a server that's looking at the wrong models directory
 * (the usual cause when OLLAMA_MODELS was set but the service restarted without
 * it). Showing what the server can actually see distinguishes the two at a
 * glance: a plausible list means a bad name, an empty one means a lost setting.
 */
function explainFailure(ollama, missing) {
  const available = localModels(ollama);
  const lines = [''];

  if (available === null) {
    lines.push('Could not ask Ollama what it has — is the service running?');
  } else if (!available.length) {
    lines.push('The Ollama service reports NO local models at all.');
    lines.push('');
    lines.push('If you have already downloaded one, the service is reading a');
    lines.push('different directory than you downloaded into — OLLAMA_MODELS is');
    lines.push('typically lost when the service restarts. Restart it with the');
    lines.push('variable set:');
    lines.push('');
    lines.push('  $env:OLLAMA_MODELS = "<your models folder>"');
    lines.push('  ollama serve');
  } else {
    lines.push(`Not found: ${missing.join(', ')}`);
    lines.push(`Available locally: ${available.join(', ')}`);
    lines.push('');
    lines.push(`Download one with:  ollama pull ${missing[0]}`);
  }

  return lines.join('\n');
}

function main() {
  // resolveOllama() also checks the standard install locations, so this works
  // in a terminal that was open before Ollama was installed.
  const ollama = resolveOllama();
  if (!ollama) {
    process.stderr.write(
      [
        '`ollama` was not found.',
        '',
        '  Install it automatically:  npm run setup',
        '  Or download it yourself:   https://ollama.com/download',
        '',
      ].join('\n')
    );
    process.exitCode = 1;
    return;
  }

  const bases = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_BASES;
  const built = [];
  const failed = [];

  for (const base of bases) {
    const name = derivedName(base);
    const modelfile = path.join(os.tmpdir(), `${name}.Modelfile`);
    fs.writeFileSync(modelfile, buildModelfile(base));

    process.stdout.write(`building ${name}  (from ${base})\n`);
    try {
      // `ollama create` pulls the base automatically if it isn't local yet.
      execFileSync(ollama, ['create', name, '-f', modelfile], { stdio: 'inherit' });
      built.push(name);
    } catch (err) {
      // A failure on one base shouldn't sink the line-up — but say why it failed.
      process.stdout.write(`  !! failed — skipping ${base}: ${err.message.split('\n')[0]}\n`);
      failed.push(base);
    } finally {
      fs.rmSync(modelfile, { force: true });
    }
  }

  if (built.length) {
    process.stdout.write(`\nBuilt ${built.length}: ${built.join(', ')}\nNext: npm run bakeoff\n`);
  }
  // The CLI already proved itself above, so any failure here is about the base
  // models. Ask the server what it actually has and say so.
  if (failed.length) {
    process.stdout.write(`${explainFailure(ollama, failed)}\n`);
  }
  if (!built.length) process.exitCode = 1;
}

main();
