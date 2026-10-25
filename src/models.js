'use strict';
// Model layer. Live mode calls the Meta Model API when a key is configured
// (Settings secrets file first, META_MODEL_API_KEY env as fallback).
// Demo mode is deterministic and local. Demo output is always labeled as simulated.
const settings = require('./settings');

function isLive() { return !!settings.loadSecrets().metaApiKey; }
function estTokens(text) { return Math.max(20, Math.ceil(String(text).length / 4)); }
const MODEL_WONDER = process.env.META_MODEL_WONDER || 'muse-wonder';
const MODEL_SPARK = process.env.META_MODEL_SPARK || 'muse-spark';

async function liveCall(model, system, user, maxTokens) {
  const s = settings.loadSecrets();
  const res = await fetch(s.metaApiBase.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.metaApiKey },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.4, max_tokens: maxTokens || undefined })
  });
  if (!res.ok) throw new Error('Meta Model API HTTP ' + res.status);
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
  const usage = data.usage || {};
  return { text, tokensIn: usage.prompt_tokens || estTokens(system + user), tokensOut: usage.completion_tokens || estTokens(text) };
}

// Test button: one minimal chat call, max_tokens 1. Reports exactly what happened.
async function testConnection() {
  const s = settings.loadSecrets();
  if (!s.metaApiKey) return { ok: false, checked: ['No Meta Model API key is configured. Nothing was called.'] };
  const checked = ['POST ' + s.metaApiBase.replace(/\/$/, '') + '/chat/completions with model ' + MODEL_SPARK + ', max_tokens 1'];
  try {
    await liveCall(MODEL_SPARK, 'You are a test probe.', 'Reply with OK.', 1);
    checked.push('The call returned HTTP 200.');
    return { ok: true, checked };
  } catch (e) {
    checked.push('The call failed: ' + String(e.message || e));
    return { ok: false, checked };
  }
}

const CODING = /(build|code|implement|app|tool|script|program|function|debug|fix the|website code|软件|代码|开发|写一个|实现)/i;

// ---- Demo decomposer: keyword templates, deterministic. Runtime tags included. ----
function demoDecompose(mission) {
  const m = mission.toLowerCase();
  const tasks = [];
  const research = { title: 'Research the landscape', role: 'Researcher', model: 'wonder', runtime: 'model-api', brief: 'Collect facts, competitors and constraints for: ' + mission, acceptance: 'Findings list with sources noted' };
  if (CODING.test(mission)) {
    tasks.push(
      { title: 'Design the solution', role: 'Planner', model: 'spark', runtime: 'model-api', brief: 'Design the approach and list the files to create for: ' + mission, acceptance: 'Short design note with a file list' },
      { title: 'Implement it', role: 'Builder', model: 'wonder', runtime: 'muse-code', brief: 'Implement the deliverable in the working directory for: ' + mission, acceptance: 'Working code exists in the task working directory' },
      { title: 'Test and fix', role: 'Builder', model: 'wonder', runtime: 'muse-code', brief: 'Run the result, fix what fails', acceptance: 'Result runs, or failures are listed with causes' });
  } else if (/(landing|page|website|site|copy|文案|落地页)/.test(m)) {
    tasks.push(research,
      { title: 'Write the copy', role: 'Copywriter', model: 'spark', runtime: 'model-api', brief: 'Draft landing page copy from the research', acceptance: 'Headline, 3 sections, one call to action' },
      { title: 'Build the page draft', role: 'Builder', model: 'wonder', runtime: 'model-api', brief: 'Turn the copy into a page outline and structure', acceptance: 'Section-by-section page draft' });
  } else if (/(report|research|competitor|market|brief|报告|竞品|研究)/.test(m)) {
    tasks.push(research,
      { title: 'Analyse and compare', role: 'Analyst', model: 'wonder', runtime: 'model-api', brief: 'Compare options against the goal and score them', acceptance: 'Comparison table with a clear winner' },
      { title: 'Write the brief', role: 'Writer', model: 'spark', runtime: 'model-api', brief: 'Turn analysis into a short brief', acceptance: 'One-page brief with a recommendation' });
  } else if (/(data|list|clean|leads|名单|数据|整理)/.test(m)) {
    tasks.push({ title: 'Collect raw data', role: 'Researcher', model: 'wonder', runtime: 'model-api', brief: 'Gather the raw entries for: ' + mission, acceptance: 'Raw list captured' },
      { title: 'Clean and dedupe', role: 'Analyst', model: 'spark', runtime: 'model-api', brief: 'Clean, dedupe and format the list', acceptance: 'Clean table, no duplicates' },
      { title: 'Verify samples', role: 'Verifier', model: 'wonder', runtime: 'model-api', brief: 'Spot-check entries for accuracy', acceptance: 'Sample check passed or issues listed' });
  } else {
    tasks.push(research,
      { title: 'Plan the work', role: 'Planner', model: 'spark', runtime: 'model-api', brief: 'Break the mission into steps with risks', acceptance: 'Step plan with risks noted' },
      { title: 'Produce the deliverable', role: 'Builder', model: 'wonder', runtime: 'model-api', brief: 'Produce the main deliverable for: ' + mission, acceptance: 'Deliverable draft complete' });
  }
  tasks.push({ title: 'Final review and delivery', role: 'Verifier', model: 'wonder', runtime: 'model-api', brief: 'Check all outputs against the goal, then deliver', acceptance: 'Review passed and summary written', needsApproval: true });
  return tasks.slice(0, 6);
}

async function decompose(missionText, goal) {
  if (!isLive()) {
    const tasks = demoDecompose(missionText);
    return { tasks, tokensIn: estTokens(missionText) + 220, tokensOut: estTokens(JSON.stringify(tasks)) + 320, live: false };
  }
  const system = 'You are a CEO agent. Split the mission into 3 to 6 sub-tasks. Reply with JSON only: {"tasks":[{"title":"...","role":"...","model":"wonder|spark","runtime":"model-api|muse-code","brief":"...","acceptance":"...","needsApproval":false}]}. Tag coding sub-tasks runtime "muse-code" and all others "model-api". Mark exactly the final delivery task needsApproval true.';
  const user = 'Company goal: ' + goal + '\nMission: ' + missionText;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await liveCall(MODEL_WONDER, system, user);
      const parsed = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1));
      if (Array.isArray(parsed.tasks) && parsed.tasks.length >= 2) {
        for (const t of parsed.tasks) if (t.runtime !== 'muse-code') t.runtime = 'model-api';
        return { tasks: parsed.tasks.slice(0, 6), tokensIn: r.tokensIn, tokensOut: r.tokensOut, live: true };
      }
    } catch (e) { /* retry once, then template fallback */ }
  }
  const tasks = demoDecompose(missionText);
  return { tasks, tokensIn: estTokens(missionText), tokensOut: estTokens(JSON.stringify(tasks)), live: false, degraded: true };
}

function demoWork(task, missionText) {
  return [
    '[DEMO MODE - simulated output]',
    'Task: ' + task.title,
    'Role: ' + task.role,
    'Mission: ' + missionText,
    'Result: Completed the brief - ' + task.brief,
    'Acceptance check: ' + task.acceptance + ' - met in this simulated run.'
  ].join('\n');
}

async function doWork(task, missionText, goal) {
  if (!isLive()) {
    const out = demoWork(task, missionText);
    return { output: out, tokensIn: 260 + estTokens(task.brief), tokensOut: estTokens(out), live: false };
  }
  const system = 'You are a ' + task.role + ' agent in an AI company. Company goal: ' + goal + '. Do the task and return the deliverable text only.';
  const user = 'Mission: ' + missionText + '\nYour task: ' + task.title + '\nBrief: ' + task.brief + '\nAcceptance: ' + task.acceptance;
  try {
    const r = await liveCall(task.model === 'spark' ? MODEL_SPARK : MODEL_WONDER, system, user);
    return { output: r.text, tokensIn: r.tokensIn, tokensOut: r.tokensOut, live: true };
  } catch (e) {
    const out = demoWork(task, missionText) + '\n(Note: live call failed, template fallback used.)';
    return { output: out, tokensIn: estTokens(user), tokensOut: estTokens(out), live: false, degraded: true };
  }
}

module.exports = { isLive, decompose, doWork, demoWork, testConnection };
