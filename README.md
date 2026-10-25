# Agent Company

Hire an AI company, not a chatbot. Set up one CEO agent, give it a mission, and watch it build its own team, split the work, and finish it inside a real budget. You only approve.

This is the real, runnable app behind the Agent Company Board prototype. State is real and persisted: companies, agents, tasks, approvals, a budget ledger, a priority queue, and a CEO activity feed. Every model call is debited from the company wallet by token usage times a configurable price table. Budget level drives strategy: Growth, Normal, Survival, Critical.

Built for the Meta Global AI Developer Hackathon (Indie developer track, theme: Build for Your World).

## Setup

Follow these steps in order. A stranger with a fresh clone can finish them in about five minutes.

### 1. Prerequisites

1. Node.js 18 or newer. Check with `node --version`.
2. Nothing else. The app has zero npm dependencies and uses a JSON file store, so there is no database to install.
3. Optional, for live mode: a Meta Model API key.
4. Optional, for builder tasks: the Muse command-line tool on your PATH.

### 2. Install and start

```bash
git clone https://github.com/z1q1chen/ai-company.git
cd ai-company
npm install   # no dependencies, this only verifies the project
npm start
```

Open http://localhost:3100. Set another port with `PORT=3200 npm start`.

On first open you see one screen only: set up your CEO agent (name, company name, one-sentence goal, initial budget). After that you land on the company home: CEO card, budget bar, mission box, approvals, priority queue, CEO activity feed, employee roster, and the task board.

### 3. Demo mode vs live mode

The app starts in **demo mode** when no Meta Model API key is configured. Demo mode uses a local, deterministic decomposer and simulated worker outputs. Every simulated output is labeled `DEMO MODE - simulated output` in the UI, and a banner at the top of the page says demo mode is on. Simulated output is never presented as real model output.

**Live mode** starts as soon as a key is configured, either in Settings (step 4) or by env var (step 5). In live mode the CEO and worker agents call the Meta Model API: Muse Wonder for the CEO and heavy work, the Muse Spark series for light tasks. If a live call fails, the task falls back to the template output and the task card says so.

### 4. API key setup, step by step (Settings page)

1. Start the app and open http://localhost:3100.
2. Create your company on the setup screen.
3. Scroll to the **Settings** card at the bottom of the page.
4. Paste your Meta Model API key into the **Meta Model API key** field.
5. Check the **Meta Model API base URL** field. The default is `https://api.meta.ai/v1`. Change it only if your access uses a different base.
6. Click **Save settings**.
7. Click **Test connection: model API**. The server makes one minimal chat call with max tokens 1 and reports success or failure in plain words, including what was called.
8. After a successful save, the Settings card shows the key as a masked value such as `••••••••abcd`. The mask shows only the last 4 characters. It proves a key is saved, so you can confirm the right key is in place, and it never shows the full key. The API never returns the full key after save, to any caller.
9. Where the key lives: the server stores it in `data/secrets.json`, on the server only. That file is listed in `.gitignore`, has file permissions 600, and is never sent to the browser except as the masked value above. Do not commit it, paste it into issues, or share it.

To remove the key, delete `data/secrets.json` and restart. The app returns to demo mode.

### 5. API key by env var (alternative)

Instead of Settings, start the server with env vars:

```bash
META_MODEL_API_KEY=your-key-here npm start
```

Optional: `META_MODEL_API_BASE` overrides the base URL, `META_MODEL_WONDER` and `META_MODEL_SPARK` override the model names. The Settings file wins when both are set, because Settings is the later, explicit choice. Env vars are the fallback at startup.

### 6. Muse adapter configuration

Builder-type sub-tasks (coding work) can run through a Muse adapter instead of the model API. The CEO decomposer tags coding sub-tasks with runtime `muse-code` and all others with runtime `model-api`. The employee roster shows each employee's runtime.

Configure it in the **Settings** card, or by env:

1. **Enable toggle**: the Settings checkbox "Enable Muse". Off means builder tasks use the model API path instead.
2. **Command**: the Settings field "Muse command", env `MUSE_CODE_CMD`, default `muse-code`. The server looks the binary up on PATH.
3. **Args template**: the Settings field "Args template". The placeholder `{prompt}` is replaced with the task brief. Example shape: `--print {prompt}`. This is a template, not a fixed command, so you can match your installed version.
4. **Version or no-op arg**: optional, used only by the Test button. Empty means the test checks binary existence on PATH and runs nothing. Set it, for example to `--version`, if you want the test to also execute the tool once.
5. **Flat estimate**: Settings fields for flat estimate tokens in and out. When a Muse run reports usage in its output, the ledger records the reported usage. When it reports nothing, the ledger records this flat estimate and the task is labeled as an estimate.

Honest limits, read before you rely on this:

- The exact Muse Code CLI invocation must be confirmed against the Muse Code documentation when access is granted at the hackathon. The defaults in this repo are placeholders to verify, not documented facts.
- The adapter spawns the configured command in a per-task working directory under `data/workdirs/<taskId>`, passes the brief through the args template, and captures stdout and stderr as the worker output.
- If the binary is missing, disabled, or exits non-zero, the task falls back to demo output and the UI labels that worker `Muse Code unavailable - demo output`, with the reason. A real run is never faked.
- Test it with the **Test connection: Muse** button in Settings. It reports exactly what it checked.

### 7. Budget configuration

All knobs live on the same Settings card and persist server-side. They are enforced in code, not in prompts.

1. **Initial balance**: the wallet size in USD. Mode percentages are computed against it.
2. **Per-mission cap percent**: a mission whose estimate exceeds this share of the remaining wallet stops and asks for approval before any worker runs.
3. **Mode thresholds**: balance percent floors for Growth, Normal, and Survival. Below the Survival floor the company is in Critical: normal missions stop, only revenue work and reporting run.
4. **Proactivity**: `off` (CEO never self-starts), `suggest` (CEO fills the priority queue and activity feed, you decide), `auto` (CEO also runs queue items whose estimated cost is under the auto-run threshold).
5. **Auto-run threshold**: the USD limit for proactivity `auto`.
6. **Model price table**: USD per 1k tokens, in and out, for Wonder and Spark. Every model call is debited as tokens times this table, and each debit is a ledger line you can audit in the UI.

Strategy follows the mode automatically. Survival downgrades new missions to cheaper models, and the priority queue re-ranks so revenue tasks rise to the top and a revenue approval is created. Mark real-world income with the "Mark revenue received" control and the wallet is credited, with a ledger line.

### 8. Run the smoke test

```bash
npm run smoke
```

The smoke test boots the real server on a throwaway data file and checks, end to end: company setup, a demo mission through the approval gate, budget debit, a builder mission with Muse absent and the labeled demo fallback, spending down into Survival with the revenue task on top and a revenue approval created, revenue crediting the wallet, saving a fake API key through the settings API and reading it back masked only, the secrets file permissions, and its `.gitignore` coverage. A passing run ends with `SMOKE OK - all checks passed`. The captured output of the latest run is in `smoke-output.txt`.

## Architecture

Five parts, matching the HLD:

1. **Web UI** (`public/index.html`): one page. Setup screen, CEO home, Settings. Polls `/api/board` every 2 seconds.
2. **Server** (`src/server.js`): plain Node `http`. API plus static UI. No framework, no dependencies.
3. **CEO engine** (`src/engine.js`): mission decomposition, worker runs, budget rules, priority scoring (Value, Urgency, Revenue, Cost) with budget-triggered re-rank, approval gates as a state machine, and the proactive CEO cycle.
4. **Model layer** (`src/models.js`): live calls to the Meta Model API when a key is configured, deterministic demo mode when not.
5. **Muse adapter** (`src/integrations/museCode.js`): configurable subprocess runner for builder tasks, with honest fallback labeling.
6. **Store** (`src/store.js`): one JSON file at `data/store.json`. State lives outside the models, so a restart loses nothing. Settings and secrets live in `src/settings.js` and `data/secrets.json`.

Data model: companies, agents (with runtime), missions, tasks, approvals, ledger, priority queue, activity feed.

## API summary

| Method and path | What it does |
|---|---|
| `GET /api/board` | Full board state: company, budget, agents, tasks, approvals, ledger, queue, activity |
| `POST /api/company` | Create the company and its CEO |
| `POST /api/mission` | Give the CEO a mission. Runs decomposition and workers, stops at the approval gate |
| `POST /api/approvals/:id` | Decide an approval: `{ "decision": "approve" }` or `"reject"` |
| `POST /api/spend` | Record a spend (used by the UI simulate control and tests) |
| `POST /api/revenue` | Mark revenue received and credit the wallet |
| `POST /api/ceo-cycle` | Run one proactive CEO cycle |
| `GET /api/settings` | Settings with the API key masked. Never returns the full key |
| `PUT /api/settings` | Save settings, secrets, and budget configuration |
| `POST /api/settings/test` | Test the model API or Muse. Body: `{ "target": "model" }` or `{ "target": "muse-code" }` |
| `GET /api/config`, `PUT /api/config` | Budget configuration only |

## Known limits

1. One user, one company. No accounts.
2. No real payments. Revenue is marked by the owner after money lands outside the system.
3. SAM 3.1 is not used. This product has no image segmentation need.
4. The Muse invocation defaults are placeholders until confirmed against its docs at the hackathon.
5. The store is a JSON file. It is the right size for a hackathon demo, not for production load.
