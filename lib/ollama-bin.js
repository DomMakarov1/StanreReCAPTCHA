'use strict';

// Finding the ollama executable is its own problem on Windows: the installer
// adds it to PATH, but only for shells started afterwards. A terminal that was
// already open — the common case right after installing — never sees it. So
// check PATH first, then the known install locations.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function candidatePaths() {
  const home = os.homedir();

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    return [
      path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
      path.join(programFiles, 'Ollama', 'ollama.exe'),
    ];
  }

  if (process.platform === 'darwin') {
    return [
      '/usr/local/bin/ollama',
      '/opt/homebrew/bin/ollama',
      '/Applications/Ollama.app/Contents/Resources/ollama',
    ];
  }

  return ['/usr/local/bin/ollama', '/usr/bin/ollama', path.join(home, '.local', 'bin', 'ollama')];
}

/** Path to a usable ollama executable, or null if none was found. */
function resolveOllama() {
  try {
    execFileSync('ollama', ['--version'], { stdio: 'pipe' });
    return 'ollama';
  } catch (err) {
    // A non-ENOENT failure means the binary IS on PATH and merely unhappy
    // (service down, most likely) — that's still the one we want to use.
    if (err.code !== 'ENOENT') return 'ollama';
  }

  return candidatePaths().find((candidate) => fs.existsSync(candidate)) || null;
}

/** True if the Ollama HTTP API answers. Independent of whether the CLI is found. */
async function daemonReady(host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434') {
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { resolveOllama, daemonReady, candidatePaths };
