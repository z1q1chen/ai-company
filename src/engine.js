'use strict';
// CEO engine: decomposition, worker runs, budget rules, priority queue, proactive cycle.
const store = require('./store');
const models = require('./models');
const museCode = require('./integrations/museCode');

const REVENUE_TASK = {
  title: 'Sell: competitor brief for indie game devs',
  kind: 'revenue', value: 6, urgency: 5, revenue: 49, estCost: 2
};

function scoreItem(it, mode) {
  let score = it.value * 2 + it.urgency * 1.5 + it.revenue * 0.6 - it.estCost * 2;
  if ((mode === 'Survival' || mode === 'Critical') && it.kind === 'revenue') score += 25;
  if (mode === 'Critical' && it.kind !== 'revenue') score -= 20;
  return Math.round(score * 10) / 10;
}

function rerank(reason) {
  const s = store.load();
  const { mode } = store.strategyMode();
  for (const it of s.priorityQueue) it.score = scoreItem(it, mode);
  s.priorityQueue.sort((a, b) => b.score - a.score);
  store.logActivity('Re-ranked the priority queue (' + mode + ' mode' + (reason ? ', ' + reason : '') + '). Top: ' + (s.priorityQueue[0] ? s.priorityQueue[0].title : 'none') + '.');
  ensureRevenueApproval();
  store.save();
}

function ensureRevenueApproval() {
  const s = store.load();
  const { mode } = store.strategyMode();
  if (mode !== 'Survival' && mode !== 'Critical') return;
  const top = s.priorityQueue[0];
  if (!top || top.kind !== 'revenue') return;
  const exists = s.approvals.some(a => a.kind === 'revenue' && a.status === 'pending');
  if (!exists) {
    s.approvals.unshift({ id: store.nextId('approval'), kind: 'revenue', taskId: null, title: 'Approve revenue mission: ' + top.title + ' - est. $' + top.revenue + ' revenue, $' + top.estCost + ' cost', status: 'pending', createdAt: new Date().toISOString(), decidedAt: null });
    store.logActivity('Survival mode: drafted a revenue proposal and sent it for approval - ' + top.title + '.');
  }
}

function seedQueue() {
  const s = store.load();
  if (s.priorityQueue.length) return;
  const items = [
    { title: 'Deep-dive the shortlist from the last mission', kind: 'work', value: 9, urgency: 6, revenue: 0, estCost: 3 },
    { title: 'Weekly cost and runway review', kind: 'ops', value: 7, urgency: 7, revenue: 0, estCost: 0.5 },
    Object.assign({}, REVENUE_TASK),
    { title: 'Clean the research backlog', kind: 'work', value: 5, urgency: 3, revenue: 0, estCost: 1.2 },
    { title: 'Draft a digital template pack to sell', kind: 'revenue', value: 6, urgency: 2, revenue: 29, estCost: 1.5 }
  ];
  for (const it of items) s.priorityQueue.push(Object.assign({ id: store.nextId('pq'), status: 'queued' }, it));
}

function createCompany({ ceoName, companyName, goal, initialBalance }) {
  const s = store.load();
  if (initialBalance != null && Number(initialBalance) > 0) s.config.initialBalance = Number(initialBalance);
  const ceo = { id: store.nextId('agent'), name: ceoName || 'Muse', role: 'CEO', kind: 'ceo', runtime: 'model-api', agentType: 'Muse Wonder - CEO', status: 'Planning', spend: 0, tasksDone: 0, promptSummary: 'Split missions, set roles and acceptance criteria, guard the budget.' };
  s.agents.push(ceo);
  s.company = { id: 'company_1', name: companyName || 'My AI Company', goal: goal || '', ceoAgentId: ceo.id, createdAt: new Date().toISOString() };
  store.addLedger({ kind: 'funding', agentId: ceo.id, label: 'Initial budget', amount: s.config.initialBalance });
  seedQueue();
  store.logActivity('Company created. CEO ' + ceo.name + ' is on duty. Budget $' + s.config.initialBalance.toFixed(2) + '.');
  rerank('company created');
  store.save();
  return s.company;
}

function getOrCreateWorker(roleName, model, runtime) {
  const s = store.load();
  runtime = runtime || 'model-api';
  let w = s.agents.find(a => a.kind === 'worker' && a.role === roleName && a.runtime === runtime);
  if (!w) {
    const base = runtime === 'muse-code' ? 'Muse' : (model === 'spark' ? 'Muse Spark' : 'Muse Wonder');
    w = { id: store.nextId('agent'), name: roleName + ' ' + (s.agents.filter(a => a.kind === 'worker').length + 1), role: roleName, kind: 'worker', runtime, agentType: base + ' - ' + roleName, status: 'Idle', spend: 0, tasksDone: 0, promptSummary: 'Template: ' + roleName + ' role plus the task brief and acceptance criteria.' };
    s.agents.push(w);
  }
  return w;
}

async function runMission(missionText) {
  const s = store.load();
  if (!s.company) throw new Error('Create the company first (POST /api/company).');
  if (!models.hasKey()) throw new Error(models.NO_KEY_ERROR);
  const bal = store.balance();
  if (bal <= 0) throw new Error('Budget is $0. Only revenue proposals are allowed.');
  const { mode } = store.strategyMode();
  if (mode === 'Critical') throw new Error('Critical budget mode: normal missions are stopped. Run a revenue task first.');

  const ceo = s.agents.find(a => a.id === s.company.ceoAgentId);
  ceo.status = 'Splitting a mission';
  store.logActivity('CEO is splitting the mission: "' + missionText + '"');

  // Decompose before any mission or task record exists. If the model call
  // fails, the error propagates and nothing is created.
  const dec = await models.decompose(missionText, s.company.goal);
  const mission = { id: store.nextId('mission'), text: missionText, status: 'running', createdAt: new Date().toISOString(), totalCost: 0, totalTokens: 0, failedTasks: 0 };
  s.missions.unshift(mission);
  const decCost = store.debitModelCall({ agentId: ceo.id, label: 'CEO decomposition: ' + missionText, model: 'wonder', tokensIn: dec.tokensIn, tokensOut: dec.tokensOut });
  mission.totalCost += decCost; mission.totalTokens += dec.tokensIn + dec.tokensOut;

  // Budget rules in code: estimate vs per-mission cap.
  const avgWorkerCost = 0.65;
  const estimate = decCost + dec.tasks.length * avgWorkerCost;
  const cap = store.balance() * (s.config.perMissionCapPercent / 100) + decCost;
  let gateApproval = null;
  if (estimate > cap) {
    gateApproval = { id: store.nextId('approval'), kind: 'budget', taskId: null, missionId: mission.id, title: 'Approve over-cap mission: est. $' + estimate.toFixed(2) + ' vs cap $' + cap.toFixed(2) + ' - ' + missionText, status: 'pending', createdAt: new Date().toISOString(), decidedAt: null };
    s.approvals.unshift(gateApproval);
    mission.status = 'waiting_budget_approval';
    store.logActivity('Mission estimate $' + estimate.toFixed(2) + ' is over the per-mission cap $' + cap.toFixed(2) + '. Sent for approval.');
    store.save();
    return { mission, tasks: [], estimate, cap, needsBudgetApproval: true };
  }

  const taskObjs = dec.tasks.map((t, i) => ({
    id: store.nextId('task'), missionId: mission.id, title: t.title, role: t.role, model: t.model === 'spark' ? 'spark' : 'wonder',
    runtime: t.runtime === 'muse-code' ? 'muse-code' : 'model-api',
    brief: t.brief, acceptance: t.acceptance, needsApproval: !!t.needsApproval,
    status: 'queued', agentId: null, output: '', tokens: 0, cost: 0, runtimeNote: ''
  }));
  // Survival downgrade: fewer workers, light tasks on Spark (FR-9).
  if (mode === 'Survival') for (const t of taskObjs) if (t.role !== 'Verifier') t.model = 'spark';
  s.tasks.unshift(...taskObjs.slice().reverse());
  store.save();
  await executeTasks(mission, taskObjs);
  return { mission, tasks: taskObjs, estimate };
}

async function executeTasks(mission, taskObjs) {
  const s = store.load();
  for (const task of taskObjs) {
    const worker = getOrCreateWorker(task.role, task.model, task.runtime);
    task.agentId = worker.id;
    if (task.needsApproval) {
      task.status = 'waiting_approval';
      const ap = { id: store.nextId('approval'), kind: 'step', taskId: task.id, missionId: mission.id, title: 'Approve final step: ' + task.title + ' (' + mission.text + ')', status: 'pending', createdAt: new Date().toISOString(), decidedAt: null };
      s.approvals.unshift(ap);
      mission.status = 'waiting_approval';
      store.logActivity('Approval gate reached: ' + task.title + '. Waiting for the owner.');
      store.save();
      return; // state machine: nothing after the gate runs until approval
    }
    await runOneTask(mission, task, worker);
  }
  finishMission(mission);
}

async function runOneTask(mission, task, worker) {
  const s = store.load();
  task.status = 'running'; worker.status = 'Working: ' + task.title;
  store.save();
  let cost = 0;
  try {
    if (task.runtime === 'muse-code') {
      const mc = await museCode.runTask({ task, missionText: mission.text });
      if (!mc.available) throw new Error('Muse run failed: ' + mc.reason);
      task.output = mc.output;
      task.tokens = mc.tokensIn + mc.tokensOut;
      if (mc.costMode === 'reported' && mc.costUsd != null) {
        store.addLedger({ kind: 'muse-code', agentId: worker.id, label: 'Muse (reported usage): ' + task.title, amount: -mc.costUsd });
        const ag = s.agents.find(a => a.id === worker.id); if (ag) ag.spend = (ag.spend || 0) + mc.costUsd;
        cost = mc.costUsd;
        task.runtimeNote = 'Muse ran this task. Usage was reported by the tool.';
      } else {
        cost = store.debitModelCall({ agentId: worker.id, label: 'Muse (flat estimate): ' + task.title, model: 'wonder', tokensIn: mc.tokensIn, tokensOut: mc.tokensOut });
        task.tokens = mc.tokensIn + mc.tokensOut;
        task.runtimeNote = 'Muse ran this task. Cost is a flat estimate from Settings, because the tool reported no usage.';
      }
    } else {
      const r = await models.doWork(task, mission.text, s.company.goal);
      cost = store.debitModelCall({ agentId: worker.id, label: 'Task: ' + task.title, model: task.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut });
      task.output = r.output; task.tokens = r.tokensIn + r.tokensOut;
    }
  } catch (e) {
    // No fallback output exists. The task fails with the real reason stored on it.
    const reason = String(e.message || e);
    task.status = 'failed';
    task.output = 'Task failed: ' + reason;
    task.runtimeNote = 'FAILED: ' + reason;
    task.cost = 0;
    worker.status = 'Idle';
    mission.failedTasks = (mission.failedTasks || 0) + 1;
    store.logActivity(worker.name + ' failed "' + task.title + '": ' + reason);
    store.save();
    return;
  }
  task.cost = cost; task.status = 'done';
  worker.tasksDone += 1; worker.status = 'Idle';
  mission.totalCost += cost; mission.totalTokens += task.tokens;
  store.logActivity(worker.name + ' finished "' + task.title + '" for $' + cost.toFixed(3) + '.');
  store.save();
}

function finishMission(mission) {
  const failed = mission.failedTasks || 0;
  mission.status = failed ? 'done_with_failures' : 'done';
  mission.finishedAt = new Date().toISOString();
  const s = store.load();
  const ceo = s.agents.find(a => a.id === s.company.ceoAgentId);
  if (ceo) ceo.status = 'Watching budget and backlog';
  store.logActivity('Mission ' + (failed ? 'finished with ' + failed + ' failed task(s)' : 'done') + ': "' + mission.text + '" Total cost $' + mission.totalCost.toFixed(2) + '.');
  rerank('mission finished');
  store.save();
}

async function decideApproval(id, decision) {
  const s = store.load();
  const ap = s.approvals.find(a => a.id === id);
  if (!ap || ap.status !== 'pending') throw new Error('Approval not found or already decided.');
  ap.status = decision === 'approve' ? 'approved' : 'rejected';
  ap.decidedAt = new Date().toISOString();
  store.logActivity('Owner ' + ap.status + ': ' + ap.title);
  if (ap.kind === 'step') {
    const task = s.tasks.find(t => t.id === ap.taskId);
    const mission = s.missions.find(m => m.id === ap.missionId);
    if (ap.status === 'approved' && task && mission) {
      const worker = getOrCreateWorker(task.role, task.model, task.runtime);
      task.agentId = worker.id;
      store.save();
      await runOneTask(mission, task, worker);
      const rest = s.tasks.filter(t => t.missionId === mission.id && t.status !== 'done' && t.status !== 'failed');
      if (!rest.length) finishMission(mission);
    } else if (task && mission) {
      task.status = 'blocked'; mission.status = 'blocked';
      store.logActivity('Task blocked after rejection: ' + task.title);
    }
  }
  if (ap.kind === 'revenue' && ap.status === 'approved') {
    const item = s.priorityQueue.find(p => p.kind === 'revenue' && p.status === 'queued');
    if (item) { item.status = 'done'; store.logActivity('Revenue mission approved and queued for production: ' + item.title + '. Mark revenue when the money lands.'); }
  }
  rerank('approval decided');
  store.save();
  return ap;
}

function spend(amount, label) {
  store.addLedger({ kind: 'manual', label: label || 'Manual expense', amount: -Math.abs(Number(amount)) });
  store.logActivity('Manual expense recorded: $' + Math.abs(Number(amount)).toFixed(2) + ' - ' + (label || 'manual expense') + '.');
  rerank('budget changed');
  store.save();
}

function revenue(amount, label) {
  store.addLedger({ kind: 'income', label: label || 'Revenue received', amount: Math.abs(Number(amount)) });
  store.logActivity('Revenue marked received: $' + Math.abs(Number(amount)).toFixed(2) + ' - ' + (label || 'sale') + '.');
  rerank('revenue landed');
  store.save();
}

async function ceoCycle() {
  const s = store.load();
  if (!s.company) throw new Error('Create the company first.');
  if (!models.hasKey()) throw new Error(models.NO_KEY_ERROR);
  if (s.config.proactivity === 'off') { store.logActivity('CEO cycle skipped: proactivity is off.'); store.save(); return { ran: false }; }
  const { mode, pct } = store.strategyMode();
  store.logActivity('CEO cycle: budget $' + store.balance().toFixed(2) + ' (' + pct.toFixed(0) + '%, ' + mode + '). Scanning backlog and opportunities.');
  const candidates = [
    { title: 'Follow up unfinished work from the last mission', kind: 'work', value: 6, urgency: 6, revenue: 0, estCost: 0.8 },
    { title: 'Research one new buyer segment for the brief product', kind: 'revenue', value: 7, urgency: 4, revenue: 35, estCost: 1.4 },
    { title: 'Summarise this week into an owner report', kind: 'ops', value: 5, urgency: 5, revenue: 0, estCost: 0.4 }
  ];
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  const item = Object.assign({ id: store.nextId('pq'), status: 'queued' }, pick);
  s.priorityQueue.push(item);
  rerank('CEO cycle');
  const top = s.priorityQueue[0];
  store.logActivity('CEO cycle proposed: "' + pick.title + '". Top of queue now: "' + (top ? top.title : 'none') + '".');
  let autoRan = null;
  if (s.config.proactivity === 'auto' && top && top.estCost <= s.config.approvalThresholdUsd && top.status === 'queued') {
    top.status = 'done';
    store.debitModelCall({ agentId: s.company.ceoAgentId, label: 'CEO auto-run: ' + top.title, model: 'spark', tokensIn: 300, tokensOut: 200 });
    autoRan = top.title;
    store.logActivity('Proactivity is auto and the cost is under the threshold. CEO ran it without asking: ' + top.title + '.');
    store.save();
  }
  return { ran: true, proposed: pick.title, top: top ? top.title : null, autoRan };
}

function board() {
  const s = store.load();
  const bal = store.balance();
  const { mode, pct } = store.strategyMode();
  const hourAgo = Date.now() - 3600 * 1000;
  const spentLastHour = s.ledger.filter(e => e.amount < 0 && new Date(e.at).getTime() > hourAgo).reduce((a, e) => a - e.amount, 0);
  const burnPerHour = spentLastHour;
  const runwayHours = burnPerHour > 0 ? bal / burnPerHour : null;
  return {
    keyConfigured: models.hasKey(),
    company: s.company, config: s.config,
    budget: { balance: Math.round(bal * 1000) / 1000, pct: Math.round(pct * 10) / 10, mode, burnPerHour: Math.round(burnPerHour * 1000) / 1000, runwayHours: runwayHours == null ? null : Math.round(runwayHours * 10) / 10 },
    agents: s.agents, missions: s.missions, tasks: s.tasks, approvals: s.approvals,
    ledger: s.ledger.slice(-8).reverse(), priorityQueue: s.priorityQueue, activity: s.activity
  };
}

module.exports = { createCompany, runMission, decideApproval, spend, revenue, ceoCycle, rerank, board, scoreItem };
