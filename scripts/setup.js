#!/usr/bin/env node
'use strict';

// Installs Ollama if it's missing, then makes sure the service is up.
//
//   npm run setup
//
// Deliberately a separate command rather than something `build-models` does on
// its own — installing software should be an action you asked for, not a side
// effect of asking for something else.

const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const { resolveOllama, daemonReady } = require('../lib/ollama-bin');

const WINDOWS_INSTALLER = 'https://ollama.com/download/OllamaSetup.exe';
const LINUX_INSTALL_SCRIPT = 'https://ollama.com/install.sh';

const say = (msg) => process.stdout.write(`${msg}\n`);

function tryCommand(cmd, args) {
  try {
    execFileSync(cmd, args, { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

/** Stream a URL to disk, reporting progress — these installers are ~1 GB. */
async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);

  const total = Number(res.headers.get('content-length')) || 0;
  let seen = 0;
  const body = Readable.fromWeb(res.body);

  body.on('data', (chunk) => {
    seen += chunk.length;
    const mb = (seen / 1e6).toFixed(0);
    const suffix = total ? ` / ${(total / 1e6).toFixed(0)} MB (${Math.round((seen / total) * 100)}%)` : ' MB';
    process.stdout.write(`\r  downloaded ${mb}${suffix}   `);
  });

  await pipeline(body, fs.createWriteStream(dest));
  process.stdout.write('\n');
}

async function installWindows() {
  say('Trying winget (Windows Package Manager)...');
  const viaWinget = tryCommand('winget', [
    'install', '--id', 'Ollama.Ollama', '-e',
    '--accept-package-agreements', '--accept-source-agreements',
  ]);
  if (viaWinget && resolveOllama()) return true;

  say('\nwinget unavailable or unsuccessful — downloading the installer directly.');
  say(`  ${WINDOWS_INSTALLER}`);
  const installer = path.join(os.tmpdir(), 'OllamaSetup.exe');
  await download(WINDOWS_INSTALLER, installer);

  say('Running the installer (this may take a minute)...');
  // Inno Setup flags: no wizard, but still show a progress window so a long
  // install doesn't look like a hang.
  tryCommand(installer, ['/SILENT', '/NORESTART']);
  fs.rmSync(installer, { force: true });
  return Boolean(resolveOllama());
}

function installMac() {
  say('Trying Homebrew...');
  if (tryCommand('brew', ['install', 'ollama']) && resolveOllama()) return true;

  say('\nHomebrew not available. Download the app directly instead:');
  say('  https://ollama.com/download/Ollama-darwin.zip');
  say('Unzip it, drag Ollama to Applications, launch it once, then re-run this.');
  return false;
}

function installLinux() {
  say(`Running the official install script (${LINUX_INSTALL_SCRIPT})...`);
  try {
    execFileSync('sh', ['-c', `curl -fsSL ${LINUX_INSTALL_SCRIPT} | sh`], { stdio: 'inherit' });
  } catch {
    return false;
  }
  return Boolean(resolveOllama());
}

/** Start `ollama serve` in the background and wait for it to answer. */
async function startDaemon(bin) {
  say('Starting the Ollama service...');
  try {
    const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    return false;
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await daemonReady()) return true;
  }
  return false;
}

async function main() {
  let bin = resolveOllama();

  if (bin) {
    say(`Ollama is already installed (${bin}).`);
  } else {
    say('Ollama not found — installing it now.\n');

    const installed =
      process.platform === 'win32' ? await installWindows()
      : process.platform === 'darwin' ? installMac()
      : installLinux();

    bin = resolveOllama();
    if (!installed || !bin) {
      say('\nCould not install Ollama automatically.');
      say('Install it by hand from https://ollama.com/download, then re-run this.');
      process.exitCode = 1;
      return;
    }
    say(`\nInstalled: ${bin}`);
  }

  if (!(await daemonReady()) && !(await startDaemon(bin))) {
    say('\nOllama is installed but its service is not responding.');
    say('Launch the Ollama app, or run `ollama serve` in another terminal.');
    process.exitCode = 1;
    return;
  }

  say('\nOllama is installed and running.');
  say('Next:  npm run build-models -- qwen3:8b');
}

main().catch((err) => {
  say(`\nSetup failed: ${err.message}`);
  say('Install by hand from https://ollama.com/download, then re-run this.');
  process.exitCode = 1;
});
