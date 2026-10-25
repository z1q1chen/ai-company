'use strict';
// Agent Company state store. One JSON file. State lives outside the models.
const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.AI_COMPANY_DATA || path.join(__dirname, '..', 'data', 'store.json');

function defaultConfig() {
  return {
    initialBalance: 20,
    perMissionCapPercent: 25,   // mission estimate above this share of the wallet needs approval
    approvalThresholdUsd: 1,    // proactivity "auto": queue items cheaper than this run without asking
    modes: { growth: 50, normal: 25, survival: 10 }, // balance % floors: >growth=Growth, >=normal=Normal, >=survival=Survival, else Critical
    proactivity: 'suggest',     // off | suggest | auto
    prices: {                   // USD per 1k tokens
      wonder: { in: 0.003, out: 0.015 },
      spark: { in: 0.0005, out: 0.002 }
    }
  };
}

function emptyState() {
  return {
    config: defaultConfig(),
    company: null, // {id,name,goal,ceoAgentId,createdAt}
    agents: [], missions: [], tasks: [], approvals: [],
    ledger: [], priorityQueue: [], activity: [],
    counters: { agent: 0, mission: 0, task: 0, approval: 0, ledger: 0, pq: 0, act: 0 }
  };
}

let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!state.config) state.config = defaultConfig();
  } catch (e) {
    state = emptyState();
    save();
  }
  return state;
}

function save() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function nextId(kind) {
  const s = load();
  s.counters[kind] += 1;
  return kind + '_' + s.counters[kind];
}

function balance() {
  const s = load();
  return s.ledger.reduce((sum, e) => sum + e.amount, 0);
}

function strategyMode() {
  const s = load();
  const bal = balance();
  const pct = s.config.initialBalance > 0 ? (bal / s.config.initialBalance) * 100 : 0;
  const m = s.config.modes;
  if (pct > m.growth) return { mode: 'Growth', pct };
  if (pct >= m.normal) return { mode: 'Normal', pct };
  if (pct >= m.survival) return { mode: 'Survival', pct };
  return { mode: 'Critical', pct };
}

function logActivity(text) {
  const s = load();
  s.activity.unshift({ id: nextId('act'), at: new Date().toISOString(), text });
  s.activity = s.activity.slice(0, 50);
}

function addLedger(entry) {
  const s = load();
  const e = Object.assign({ id: nextId('ledger'), at: new Date().toISOString() }, entry);
  s.ledger.push(e);
  return e;
}

// Debit one model call: tokens x price table. Returns cost in USD.
function debitModelCall({ agentId, label, model, tokensIn, tokensOut }) {
  const s = load();
  const p = s.config.prices[model] || s.config.prices.wonder;
  const cost = (tokensIn / 1000) * p.in + (tokensOut / 1000) * p.out;
  addLedger({ kind: 'model', agentId, label, model, tokensIn, tokensOut, amount: -cost });
  const agent = s.agents.find(a => a.id === agentId);
  if (agent) agent.spend = (agent.spend || 0) + cost;
  return cost;
}

module.exports = { load, save, nextId, balance, strategyMode, logActivity, addLedger, debitModelCall, defaultConfig, DATA_FILE };
