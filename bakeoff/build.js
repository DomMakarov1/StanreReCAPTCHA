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

const DEFAULT_BASES = ['qwen3:8b', 'llama3.1:8b', 'gemma3:12b', 'mistral-small3.2'];

const TEMPLATE = path.join(__dirname, '..', 'models', 'Modelfile.template');

/** qwen3:8b -> relate-qwen3-8b */
function derivedName(base) {
  return `relate-${base.replace(/[:/]/g, '-').replace(/[^a-zA-Z0-9._-]/g, '')}`;
}

function main() {
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
      execFileSync('ollama', ['create', name, '-f', modelfile], { stdio: 'inherit' });
      built.push(name);
    } catch {
      // A missing base model shouldn't sink the whole line-up.
      process.stdout.write(`  !! failed — skipping ${base}\n`);
    } finally {
      fs.rmSync(modelfile, { force: true });
    }
  }

  process.stdout.write(
    built.length
      ? `\nBuilt ${built.length}: ${built.join(', ')}\nNext: npm run bakeoff\n`
      : '\nNothing built. Is `ollama` on your PATH and the daemon running?\n'
  );
  if (!built.length) process.exitCode = 1;
}

main();
