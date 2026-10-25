'use strict';
// Smoke test. Boots the real server on a throwaway data file and drives the API.
// Asserts: company setup, demo mission end to end with the approval gate, budget
// debit, Muse fallback labeling, Survival mode with the revenue task on
// top, a revenue approval, and settings key masking plus gitignore coverage.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3457;
const BASE = 'http://localhost:' + PORT;
const TMP = '/tmp/ai-company-smoke';
const SECRETS = path.join(TMP, 'secrets.json');
let failures = 0;

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

    // Point Muse at a binary that does not exist, for a deterministic fallback test.
    await api('PUT', '/api/settings', { museCodeCmd: 'muse-code-definitely-absent-xyz' });

    const c = await api('POST', '/api/company', { ceoName: 'Muse', companyName: 'Smoke Co', goal: 'Earn its keep', initialBalance: 20 });
    check('company created', c.status === 201 && !!c.body.id);
    let b = (await api('GET', '/api/board')).body;
    check('starts in demo mode', b.liveMode === false);
    check('budget funded at $20', Math.abs(b.budget.balance - 20) < 0.001, 'balance=' + b.budget.balance);
    check('roster has the CEO with a runtime', b.agents.length === 1 && b.agents[0].runtime === 'model-api');

    const m1 = await api('POST', '/api/mission', { text: 'Research competitors for a habit tracker app and write a brief' });
    check('mission 1 decomposed into tasks', m1.body.tasks && m1.body.tasks.length >= 3, 'tasks=' + (m1.body.tasks || []).length);
    b = (await api('GET', '/api/board')).body;
    const gate = b.approvals.find(a => a.kind === 'step' && a.status === 'pending');
    check('approval gate stops the final step', !!gate && b.missions[0].status === 'waiting_approval');
    await api('POST', '/api/approvals/' + gate.id, { decision: 'approve' });
    b = (await api('GET', '/api/board')).body;
    check('mission 1 done after approval', b.missions[0].status === 'done');
    check('all mission 1 tasks done', b.tasks.filter(t => t.missionId === b.missions[0].id).every(t => t.status === 'done'));
    check('budget was debited by model calls', b.budget.balance < 20, 'balance=' + b.budget.balance.toFixed(3));
    check('ledger matches the balance', Math.abs(b.ledger.length) > 0);

    const m2 = await api('POST', '/api/mission', { text: 'Build a small script that converts CSV files to JSON' });
    b = (await api('GET', '/api/board')).body;
    const gate2 = b.approvals.find(a => a.kind === 'step' && a.status === 'pending');
    if (gate2) await api('POST', '/api/approvals/' + gate2.id, { decision: 'approve' });
    b = (await api('GET', '/api/board')).body;
    const mcTasks = b.tasks.filter(t => t.runtime === 'muse-code');
    check('CEO tagged coding sub-tasks with runtime muse-code', mcTasks.length >= 1, 'muse-code tasks=' + mcTasks.length);
    check('Muse absent -> labeled demo fallback, never faked', mcTasks.every(t => t.output.includes('Muse Code unavailable - demo output')), mcTasks.map(t => t.runtimeNote).join(' | '));
    check('roster shows a Muse runtime employee', b.agents.some(a => a.runtime === 'muse-code'));

    const balNow = b.budget.balance;
    await api('POST', '/api/spend', { amount: balNow - 4, label: 'Smoke: spend into Survival' });
    b = (await api('GET', '/api/board')).body;
    check('crossed into Survival mode', b.budget.mode === 'Survival', 'balance=' + b.budget.balance.toFixed(2) + ' pct=' + b.budget.pct);
    check('revenue task is on top of the priority queue', b.priorityQueue[0] && b.priorityQueue[0].kind === 'revenue', 'top=' + (b.priorityQueue[0] || {}).title);
    check('revenue approval was created', b.approvals.some(a => a.kind === 'revenue' && a.status === 'pending'));

    await api('POST', '/api/revenue', { amount: 49, label: 'Smoke: brief sold' });
    b = (await api('GET', '/api/board')).body;
    check('revenue credits the wallet', Math.abs(b.budget.balance - 53) < 0.01, 'balance=' + b.budget.balance.toFixed(2));

    // Settings: save a fake key, confirm it is masked on read and never returned in full.
    const FAKE = 'sk-fake-1234567890abcd';
    await api('PUT', '/api/settings', { metaApiKey: FAKE });
    const st = await api('GET', '/api/settings');
    check('settings reports the key as configured', st.body.metaApiKeyConfigured === true);
    check('GET settings returns only the masked key', st.body.metaApiKeyMasked.endsWith('abcd') && !JSON.stringify(st.body).includes(FAKE), 'masked=' + st.body.metaApiKeyMasked);
    const mode = fs.statSync(SECRETS).mode & 0o777;
    check('secrets file has 600 permissions', mode === 0o600, 'mode=' + mode.toString(8));
    const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
    check('secrets file is gitignored', gi.includes('data/secrets.json'));

    console.log(failures === 0 ? 'SMOKE OK - all checks passed' : 'SMOKE FAILED - ' + failures + ' check(s) failed');
    process.exitCode = failures === 0 ? 0 : 1;
  } catch (e) {
    console.log('FAIL - smoke crashed: ' + (e && e.message));
    process.exitCode = 1;
  } finally {
    server.kill('SIGKILL');
  }
})();
