'use strict';
// Model layer. All agent work goes through the Meta Model API.
// A key must be configured (Settings secrets file first, META_MODEL_API_KEY
// env as fallback). With no key, decompose() and doWork() throw a clear
// error and nothing runs. There is no offline mode and no fallback output:
// a failed live call fails the task with the real error.
const settings = require('./settings');

const NO_KEY_ERROR = 'No API key configured. Add one in Settings.';

function hasKey() { return !!settings.loadSecrets().metaApiKey; }
function estTokens(text) { return Math.max(20, Math.ceil(String(text).length / 4)); }
const MODEL_WONDER = process.env.META_MODEL_WONDER || 'muse-wonder';
const MODEL_SPARK = process.env.META_MODEL_SPARK || 'muse-spark';

async function liveCall(model, system, user, maxTokens) {
  const s = settings.loadSecrets();
  if (!s.metaApiKey) throw new Error(NO_KEY_ERROR);
  let res;
  try {
    res = await fetch(s.metaApiBase.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.metaApiKey },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.4, max_tokens: maxTokens || undefined })
    });
  } catch (e) {
    throw new Error('Meta Model API request failed: ' + String(e.message || e));
  }
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

async function decompose(missionText, goal) {
  if (!hasKey()) throw new Error(NO_KEY_ERROR);
  const system = 'You are a CEO agent. Split the mission into 3 to 6 sub-tasks. Reply with JSON only: {"tasks":[{"title":"...","role":"...","model":"wonder|spark","runtime":"model-api|muse-code","brief":"...","acceptance":"...","needsApproval":false}]}. Tag coding sub-tasks runtime "muse-code" and all others "model-api". Mark exactly the final delivery task needsApproval true.';
  const user = 'Company goal: ' + goal + '\nMission: ' + missionText;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await liveCall(MODEL_WONDER, system, user);
      const parsed = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1));
      if (Array.isArray(parsed.tasks) && parsed.tasks.length >= 2) {
        for (const t of parsed.tasks) if (t.runtime !== 'muse-code') t.runtime = 'model-api';
        return { tasks: parsed.tasks.slice(0, 6), tokensIn: r.tokensIn, tokensOut: r.tokensOut };
      }
      lastErr = new Error('CEO decomposition returned no usable task list.');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('CEO decomposition failed.');
}

async function doWork(task, missionText, goal) {
  if (!hasKey()) throw new Error(NO_KEY_ERROR);
  const system = 'You are a ' + task.role + ' agent in an AI company. Company goal: ' + goal + '. Do the task and return the deliverable text only.';
  const user = 'Mission: ' + missionText + '\nYour task: ' + task.title + '\nBrief: ' + task.brief + '\nAcceptance: ' + task.acceptance;
  const r = await liveCall(task.model === 'spark' ? MODEL_SPARK : MODEL_WONDER, system, user);
  return { output: r.text, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
}

module.exports = { hasKey, decompose, doWork, testConnection, NO_KEY_ERROR };
