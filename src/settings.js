'use strict';
// Settings and secrets. Secrets live server-side only, in a gitignored file with 0600 permissions.
// Startup reads the secrets file first, then falls back to env vars.
const fs = require('fs');
const path = require('path');

const SECRETS_FILE = process.env.AI_COMPANY_SECRETS || path.join(__dirname, '..', 'data', 'secrets.json');

function defaults() {
  return {
    metaApiKey: '',
    metaApiBase: 'https://api.meta.ai/v1',
    museCodeEnabled: true,
    museCodeCmd: 'muse-code',
    museCodeArgs: '{prompt}', // args template. {prompt} is replaced with the task brief. PLACEHOLDER: confirm against Muse Code docs.
    museCodeVersionArg: '',    // optional no-op arg for the test button, e.g. '--version'. Empty = existence check only.
    museCodeFlatTokensIn: 4000,  // flat estimate used when Muse Code reports no usage
    museCodeFlatTokensOut: 2000
  };
}

function loadSecrets() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')); } catch (e) { /* no file yet */ }
  const d = defaults();
  return {
    metaApiKey: file.metaApiKey || process.env.META_MODEL_API_KEY || '',
    metaApiBase: file.metaApiBase || process.env.META_MODEL_API_BASE || d.metaApiBase,
    museCodeEnabled: file.museCodeEnabled != null ? !!file.museCodeEnabled : (process.env.MUSE_CODE_ENABLED != null ? process.env.MUSE_CODE_ENABLED !== '0' : d.museCodeEnabled),
    museCodeCmd: file.museCodeCmd || process.env.MUSE_CODE_CMD || d.museCodeCmd,
    museCodeArgs: file.museCodeArgs != null ? file.museCodeArgs : d.museCodeArgs,
    museCodeVersionArg: file.museCodeVersionArg != null ? file.museCodeVersionArg : d.museCodeVersionArg,
    museCodeFlatTokensIn: file.museCodeFlatTokensIn != null ? Number(file.museCodeFlatTokensIn) : d.museCodeFlatTokensIn,
    museCodeFlatTokensOut: file.museCodeFlatTokensOut != null ? Number(file.museCodeFlatTokensOut) : d.museCodeFlatTokensOut
  };
}

function saveSecrets(patch) {
  let current = {};
  try { current = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')); } catch (e) {}
  const next = Object.assign({}, current);
  for (const k of ['metaApiBase', 'museCodeCmd', 'museCodeArgs', 'museCodeVersionArg']) if (patch[k] != null) next[k] = String(patch[k]);
  for (const k of ['museCodeFlatTokensIn', 'museCodeFlatTokensOut']) if (patch[k] != null) next[k] = Number(patch[k]);
  if (patch.museCodeEnabled != null) next.museCodeEnabled = !!patch.museCodeEnabled;
  if (patch.metaApiKey) next.metaApiKey = String(patch.metaApiKey); // empty string never wipes a saved key
  fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  try { fs.chmodSync(SECRETS_FILE, 0o600); } catch (e) {}
  return loadSecrets();
}

function maskedView() {
  const s = loadSecrets();
  const key = s.metaApiKey || '';
  return {
    metaApiKeyConfigured: !!key,
    metaApiKeyMasked: key ? '••••••••' + key.slice(-4) : '',
    metaApiBase: s.metaApiBase,
    museCodeEnabled: s.museCodeEnabled,
    museCodeCmd: s.museCodeCmd,
    museCodeArgs: s.museCodeArgs,
    museCodeVersionArg: s.museCodeVersionArg,
    museCodeFlatTokensIn: s.museCodeFlatTokensIn,
    museCodeFlatTokensOut: s.museCodeFlatTokensOut,
    secretsFile: path.basename(SECRETS_FILE)
  };
}

module.exports = { loadSecrets, saveSecrets, maskedView, SECRETS_FILE };
