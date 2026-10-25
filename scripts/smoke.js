'use strict';
// Smoke test. Boots the real server on a throwaway data file and drives the API.
// There is no demo mode in this app. The test asserts:
// 1. With no API key, a mission and a CEO cycle are refused with the clear
//    error "No API key configured. Add one in Settings." and nothing is created.
// 2. Manual expense bookkeeping still works: spend into Survival, the revenue
//    task tops the queue, a revenue approval is created, revenue credits.
// 3. Settings: a fake key (used only for masking checks, never for a model
//    call) reads back masked only, the secrets file is 600 and gitignored.
// 4. With the fake key pointing at a dead local base URL, a mission fails
//    honestly at decomposition and still creates no tasks.
// 5. Muse adapter, called directly: an absent binary and a non-zero
//    exit both return available:false with the real reason. The binary lookup
//    also covers ~/.local/bin, where the official installer puts `muse`.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3457;
const BASE = 'http://localhost:' + PORT;
const TMP = '/tmp/ai-company-smoke';
const SECRETS = path.join(TMP, 'secrets.json');
const NO_KEY_ERROR = 'No API key configured. Add one in Settings.';
let failures = 0;

// The adapter and settings modules read these env vars at load time.
process.env.AI_COMPANY_SECRETS = SECRETS;
process.env.AI_COMPANY_WORKDIRS = path.join(TMP, 'workdirs');

function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name + (extra ? ' (' + extra + ')' : ''));
  if (!cond) failures++;
}
async function api(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}
async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/board'); if (r.ok) return; } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not come up');
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const env = Object.assign({}, process.env, {
    PORT: String(PORT),
    AI_COMPANY_DATA: path.join(TMP, 'store.json'),
    AI_COMPANY_SECRETS: SECRETS,
    AI_COMPANY_WORKDIRS: path.join(TMP, 'workdirs')
  });
  delete env.META_MODEL_API_KEY;
  const server = spawn('node', [path.join(__dirname, '..', 'src', 'server.js')], { env, stdio: 'pipe' });
  server.stderr.on('data', d => process.stderr.write('[server] ' + d));
  try {
    await waitUp();
    check('server boots', true);

    await api('PUT', '/api/settings', { museCodeCmd: 'muse-code-definitely-absent-xyz' });

    const c = await api('POST', '/api/company', { ceoName: 'Muse', companyName: 'Smoke Co', goal: 'Earn its keep', initialBalance: 20 });
    check('company created without a key', c.status === 201 && !!c.body.id);
    let b = (await api('GET', '/api/board')).body;
    check('board reports no key configured', b.keyConfigured === false);
    check('budget funded at $20', Math.abs(b.budget.balance - 20) < 0.001, 'balance=' + b.budget.balance);
    check('roster has the CEO', b.agents.length === 1 && b.agents[0].kind === 'ceo');

    // No-key refusal path: mission and CEO cycle refuse, nothing is created.
    const m0 = await api('POST', '/api/mission', { text: 'Research competitors for a habit tracker app and write a brief' });
    check('mission without a key is refused', m0.status === 400 && (m0.body.error || '') === NO_KEY_ERROR, 'error=' + (m0.body.error || ''));
    const cy0 = await api('POST', '/api/ceo-cycle', {});
    check('CEO cycle without a key is refused', cy0.status === 400 && (cy0.body.error || '') === NO_KEY_ERROR, 'error=' + (cy0.body.error || ''));
    b = (await api('GET', '/api/board')).body;
    check('refusal created zero missions and zero tasks', b.missions.length === 0 && b.tasks.length === 0, 'missions=' + b.missions.length + ' tasks=' + b.tasks.length);
    check('refusal debited nothing', Math.abs(b.budget.balance - 20) < 0.001, 'balance=' + b.budget.balance);

    // Manual expense bookkeeping: a ledger entry, not an agent run.
    await api('POST', '/api/spend', { amount: 16, label: 'Smoke: manual expense' });
    b = (await api('GET', '/api/board')).body;
    check('manual expense crossed the company into Survival mode', b.budget.mode === 'Survival', 'balance=' + b.budget.balance.toFixed(2) + ' pct=' + b.budget.pct);
    check('revenue task is on top of the priority queue', b.priorityQueue[0] && b.priorityQueue[0].kind === 'revenue', 'top=' + (b.priorityQueue[0] || {}).title);
    check('revenue approval was created', b.approvals.some(a => a.kind === 'revenue' && a.status === 'pending'));

    await api('POST', '/api/revenue', { amount: 49, label: 'Smoke: brief sold' });
    b = (await api('GET', '/api/board')).body;
    check('revenue credits the wallet', Math.abs(b.budget.balance - 53) < 0.01, 'balance=' + b.budget.balance.toFixed(2));

    // Settings: the fake key is used only to test masking. Its base URL is a
    // dead local port, so no model is ever reached with it.
    const FAKE = 'sk-fake-1234567890abcd';
    await api('PUT', '/api/settings', { metaApiKey: FAKE, metaApiBase: 'http://127.0.0.1:9/v1' });
    const st = await api('GET', '/api/settings');
    check('settings reports the key as configured', st.body.metaApiKeyConfigured === true);
    check('GET settings returns only the masked key', st.body.metaApiKeyMasked.endsWith('abcd') && !JSON.stringify(st.body).includes(FAKE), 'masked=' + st.body.metaApiKeyMasked);
    const mode = fs.statSync(SECRETS).mode & 0o777;
    check('secrets file has 600 permissions', mode === 0o600, 'mode=' + mode.toString(8));
    const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
    check('secrets file is gitignored', gi.includes('data/secrets.json'));

    // With a key that cannot reach any model, the mission fails honestly at
    // decomposition. No fallback output exists, so nothing is created.
    const m1 = await api('POST', '/api/mission', { text: 'Build a small script that converts CSV files to JSON' });
    check('mission with an unreachable API fails with a real error', m1.status === 400 && /Meta Model API/.test(m1.body.error || ''), 'error=' + (m1.body.error || ''));
    b = (await api('GET', '/api/board')).body;
    check('failed decomposition created zero missions and zero tasks', b.missions.length === 0 && b.tasks.length === 0, 'missions=' + b.missions.length + ' tasks=' + b.tasks.length);

    // Muse adapter, called directly in this process (same secrets file).
    const settings = require('../src/settings');
    const museCode = require('../src/integrations/museCode');
    settings.saveSecrets({ museCodeEnabled: true, museCodeCmd: 'muse-code-definitely-absent-xyz', museCodeArgs: '{prompt}' });
    const fakeTask = { id: 'smoke_task', title: 'T', brief: 'B', acceptance: 'A' };
    const miss = await museCode.runTask({ task: fakeTask, missionText: 'M' });
    check('Muse absent -> unavailable with the real reason', miss.available === false && /binary not found/.test(miss.reason || ''), 'reason=' + (miss.reason || ''));
    settings.saveSecrets({ museCodeCmd: '/bin/false' });
    const nz = await museCode.runTask({ task: fakeTask, missionText: 'M' });
    check('Muse non-zero exit -> unavailable with the real reason', nz.available === false && /exit code 1/.test(nz.reason || ''), 'reason=' + (nz.reason || ''));
    const inLocalBin = fs.existsSync(path.join(os.homedir(), '.local', 'bin', 'muse'));
    check('binary lookup covers ~/.local/bin', !inLocalBin || museCode.binaryExists('muse') === true, inLocalBin ? 'muse is installed in ~/.local/bin' : 'muse not installed here, lookup check skipped');

    console.log(failures === 0 ? 'SMOKE OK - all checks passed' : 'SMOKE FAILED - ' + failures + ' check(s) failed');
    process.exitCode = failures === 0 ? 0 : 1;
  } catch (e) {
    console.log('FAIL - smoke crashed: ' + (e && e.message));
    process.exitCode = 1;
  } finally {
    server.kill('SIGKILL');
  }
})();
