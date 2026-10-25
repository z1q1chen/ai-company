'use strict';
// Agent Company server. Plain Node http. API plus a single-page UI.
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const engine = require('./engine');
const settings = require('./settings');
const models = require('./models');
const museCode = require('./integrations/museCode');

const PORT = process.env.PORT || 3100;
const PUBLIC = path.join(__dirname, '..', 'public');

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/board' && req.method === 'GET') return json(res, 200, engine.board());
    if (p === '/api/company' && req.method === 'POST') {
      const b = await readBody(req);
      return json(res, 201, engine.createCompany(b));
    }
    if (p === '/api/mission' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.text) return json(res, 400, { error: 'text is required' });
      const r = await engine.runMission(String(b.text));
      return json(res, 201, r);
    }
    const apMatch = p.match(/^\/api\/approvals\/([\w-]+)$/);
    if (apMatch && req.method === 'POST') {
      const b = await readBody(req);
      const ap = await engine.decideApproval(apMatch[1], b.decision === 'approve' ? 'approve' : 'reject');
      return json(res, 200, ap);
    }
    if (p === '/api/spend' && req.method === 'POST') {
      const b = await readBody(req);
      engine.spend(Number(b.amount || 0), b.label);
      return json(res, 200, engine.board().budget);
    }
    if (p === '/api/revenue' && req.method === 'POST') {
      const b = await readBody(req);
      engine.revenue(Number(b.amount || 0), b.label);
      return json(res, 200, engine.board().budget);
    }
    if (p === '/api/ceo-cycle' && req.method === 'POST') {
      const r = await engine.ceoCycle();
      return json(res, 200, r);
    }
    if (p === '/api/settings' && req.method === 'GET') {
      // Never return the full key. Masked view only.
      return json(res, 200, Object.assign(settings.maskedView(), { budget: store.load().config }));
    }
    if (p === '/api/settings' && req.method === 'PUT') {
      const b = await readBody(req);
      settings.saveSecrets(b);
      if (b.budget) {
        const s = store.load(); const c = s.config; const bb = b.budget;
        if (bb.initialBalance != null) c.initialBalance = Number(bb.initialBalance);
        if (bb.perMissionCapPercent != null) c.perMissionCapPercent = Number(bb.perMissionCapPercent);
        if (bb.approvalThresholdUsd != null) c.approvalThresholdUsd = Number(bb.approvalThresholdUsd);
        if (bb.proactivity) c.proactivity = String(bb.proactivity);
        if (bb.modes) c.modes = { growth: Number(bb.modes.growth), normal: Number(bb.modes.normal), survival: Number(bb.modes.survival) };
        if (bb.prices) c.prices = bb.prices;
        store.save();
      }
      store.logActivity('Settings updated by the owner.');
      store.save();
      return json(res, 200, Object.assign(settings.maskedView(), { budget: store.load().config }));
    }
    if (p === '/api/settings/test' && req.method === 'POST') {
      const b = await readBody(req);
      if (b.target === 'muse-code') return json(res, 200, await museCode.testConnection());
      return json(res, 200, await models.testConnection());
    }
    if (p === '/api/config' && req.method === 'GET') return json(res, 200, store.load().config);
    if (p === '/api/config' && req.method === 'PUT') {
      const b = await readBody(req);
      const s = store.load();
      const c = s.config;
      if (b.initialBalance != null) c.initialBalance = Number(b.initialBalance);
      if (b.perMissionCapPercent != null) c.perMissionCapPercent = Number(b.perMissionCapPercent);
      if (b.approvalThresholdUsd != null) c.approvalThresholdUsd = Number(b.approvalThresholdUsd);
      if (b.proactivity) c.proactivity = String(b.proactivity);
      if (b.modes) c.modes = { growth: Number(b.modes.growth), normal: Number(b.modes.normal), survival: Number(b.modes.survival) };
      if (b.prices) c.prices = b.prices;
      store.logActivity('Budget configuration updated by the owner.');
      engine.rerank('config changed');
      store.save();
      return json(res, 200, c);
    }
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'));
    }
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 400, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  const live = models.isLive();
  console.log('Agent Company listening on http://localhost:' + PORT + ' - ' + (live ? 'LIVE MODE (Meta Model API key configured)' : 'DEMO MODE (simulated agents, no Meta Model API key configured)'));
});
