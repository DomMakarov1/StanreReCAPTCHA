#!/usr/bin/env node
'use strict';

// Creates one `relate-*` Ollama model per base model, all from the same
// Modelfile template, so the bake-off compares base models and nothing else.
//
//   npm run build-models                    # the default line-up
//   npm run build-models -- qwen3:14b       # specific bases

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveOllama } = require('../lib/ollama-bin');

const DEFAULT_BASES = ['qwen3:8b', 'llama3.1:8b', 'gemma3:12b', 'mistral-small3.2'];

const TEMPLATE = path.join(__dirname, '..', 'models', 'Modelfile.template');

/** qwen3:8b -> relate-qwen3-8b */
function derivedName(base) {
  return `relate-${base.replace(/[:/]/g, '-').replace(/[^a-zA-Z0-9._-]/g, '')}`;
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
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const built = [];

  for (const base of bases) {
    const name = derivedName(base);
    const modelfile = path.join(os.tmpdir(), `${name}.Modelfile`);
    fs.writeFileSync(modelfile, template.replace('__BASE__', base));

    process.stdout.write(`building ${name}  (from ${base})\n`);
    try {
      // `ollama create` pulls the base automatically if it isn't local yet.
      execFileSync(ollama, ['create', name, '-f', modelfile], { stdio: 'inherit' });
      built.push(name);
    } catch (err) {
      // A failure on one base shouldn't sink the line-up — but say why it failed.
      process.stdout.write(`  !! failed — skipping ${base}: ${err.message.split('\n')[0]}\n`);
    } finally {
      fs.rmSync(modelfile, { force: true });
    }
  }

  // Preflight already proved the CLI works, so a total wipeout here is about
  // the base models themselves, not the install.
  process.stdout.write(
    built.length
      ? `\nBuilt ${built.length}: ${built.join(', ')}\nNext: npm run bakeoff\n`
      : '\nNothing built — see the errors above. Usually the base model name is\n' +
        'wrong or the download failed. Check available names at\n' +
        'https://ollama.com/library, then retry one at a time:\n' +
        '  npm run build-models -- qwen3:8b\n'
  );
  if (!built.length) process.exitCode = 1;
}

main();
