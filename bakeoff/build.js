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

/**
 * Confirm the `ollama` CLI exists before attempting any build, so a missing
 * install reports itself once and clearly rather than as N identical failures.
 * Returns an error string, or null when everything looks fine.
 */
function preflight() {
  try {
    execFileSync('ollama', ['--version'], { stdio: 'pipe' });
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [
        "`ollama` was not found on your PATH.",
        '',
        '  - Not installed?  Get it from https://ollama.com/download',
        '  - Just installed? Close this terminal and open a new one — the',
        '    installer adds Ollama to PATH, but only for new shells.',
      ].join('\n');
    }
    // The binary exists but errored — almost always the background service.
    return [
      `\`ollama --version\` failed: ${err.message.split('\n')[0]}`,
      '',
      '  The Ollama service may not be running. Launch the Ollama app, or run',
      '  `ollama serve` in a separate terminal, then try again.',
    ].join('\n');
  }
}

function main() {
  const problem = preflight();
  if (problem) {
    process.stderr.write(`${problem}\n`);
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
      execFileSync('ollama', ['create', name, '-f', modelfile], { stdio: 'inherit' });
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
