'use strict';
// Muse Code adapter.
//
// The Muse binary is named `muse`. Install it with the official
// script: curl -fsSL https://dev.meta.ai/install.sh | bash (lands in
// ~/.local/bin/muse). Sign-in is separate: browser sign-in, or the
// META_API_KEY env var for non-interactive use.
// IMPORTANT: the exact headless invocation is still to be confirmed against
// the Muse Code documentation. The args template is fully configurable
// in Settings; its default is a placeholder, not a documented fact.
// This adapter never fakes a run: a missing binary or a non-zero exit makes
// the caller fall back to demo output, labeled as such.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const settings = require('../settings');

const WORK_ROOT = process.env.AI_COMPANY_WORKDIRS || path.join(__dirname, '..', '..', 'data', 'workdirs');
const TIMEOUT_MS = Number(process.env.MUSE_CODE_TIMEOUT_MS || 120000);

function binaryExists(cmd) {
  if (!cmd) return false;
  if (cmd.includes('/')) { try { fs.accessSync(cmd, fs.constants.X_OK); return true; } catch (e) { return false; } }
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    try { fs.accessSync(path.join(d, cmd), fs.constants.X_OK); return true; } catch (e) { /* keep looking */ }
  }
  return false;
}

function splitArgs(template, prompt) {
  if (!template) return [prompt];
  return template.split(/\s+/).filter(Boolean).map(a => a.replace('{prompt}', prompt));
}

function run(cmd, args, cwd) {
  return new Promise(resolve => {
    let out = '', err = '', done = false;
    const child = spawn(cmd, args, { cwd, shell: false });
    const timer = setTimeout(() => { if (!done) { done = true; child.kill('SIGKILL'); resolve({ code: -1, out, err: err + '\nTimed out after ' + TIMEOUT_MS + 'ms' }); } }, TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -2, out, err: String(e.message || e) }); } });
    child.on('close', code => { if (!done) { done = true; clearTimeout(timer); resolve({ code, out, err }); } });
  });
}

// Try to read reported usage from a JSON blob in stdout. Returns null when absent.
function parseUsage(out) {
  const lines = out.trim().split('\n').reverse();
  for (const line of lines) {
    try {
      const j = JSON.parse(line);
      const u = j.usage || j;
      const tokensIn = u.input_tokens != null ? u.input_tokens : u.prompt_tokens;
      const tokensOut = u.output_tokens != null ? u.output_tokens : u.completion_tokens;
      if (tokensIn != null || tokensOut != null || u.cost_usd != null) {
        return { tokensIn: Number(tokensIn || 0), tokensOut: Number(tokensOut || 0), costUsd: u.cost_usd != null ? Number(u.cost_usd) : null };
      }
    } catch (e) { /* not JSON */ }
  }
  return null;
}

async function runTask({ task, missionText }) {
  const s = settings.loadSecrets();
  if (!s.museCodeEnabled) return { available: false, reason: 'Muse Code is disabled in Settings' };
  if (!binaryExists(s.museCodeCmd)) return { available: false, reason: 'binary not found on PATH: ' + s.museCodeCmd };
  const workdir = path.join(WORK_ROOT, task.id);
  fs.mkdirSync(workdir, { recursive: true });
  const prompt = 'Mission: ' + missionText + '\nTask: ' + task.title + '\nBrief: ' + task.brief + '\nAcceptance: ' + task.acceptance + '\nWork in this directory and print the result to stdout.';
  const args = splitArgs(s.museCodeArgs, prompt);
  const r = await run(s.museCodeCmd, args, workdir);
  if (r.code !== 0) return { available: false, reason: 'exit code ' + r.code + (r.err ? ': ' + r.err.slice(-300) : '') };
  const usage = parseUsage(r.out);
  if (usage) return { available: true, output: r.out, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd, costMode: 'reported', workdir };
  return { available: true, output: r.out, tokensIn: s.museCodeFlatTokensIn, tokensOut: s.museCodeFlatTokensOut, costUsd: null, costMode: 'estimate', workdir };
}

// Test button check. Reports exactly what was checked.
async function testConnection() {
  const s = settings.loadSecrets();
  const checked = [];
  if (!s.museCodeEnabled) return { ok: false, checked: ['Muse Code is disabled in Settings. Nothing was run.'] };
  const exists = binaryExists(s.museCodeCmd);
  checked.push('Binary existence on PATH: "' + s.museCodeCmd + '" -> ' + (exists ? 'found' : 'NOT found'));
  if (!exists) return { ok: false, checked };
  if (s.museCodeVersionArg) {
    const r = await run(s.museCodeCmd, [s.museCodeVersionArg], WORK_ROOT);
    checked.push('Ran "' + s.museCodeCmd + ' ' + s.museCodeVersionArg + '" -> exit ' + r.code + (r.out ? ', output: ' + r.out.trim().slice(0, 120) : ''));
    return { ok: r.code === 0, checked };
  }
  checked.push('No version/no-op arg configured in Settings, so the binary was not executed.');
  return { ok: true, checked };
}

module.exports = { runTask, testConnection, binaryExists };
