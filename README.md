# Agent Company

Hire an AI company, not a chatbot. Set up one CEO agent, give it a mission, and watch it build its own team, split the work, and finish it inside a real budget. You only approve.

This is the real, runnable app behind the Agent Company Board prototype. State is real and persisted: companies, agents, tasks, approvals, a budget ledger, a priority queue, and a CEO activity feed. Every model call is debited from the company wallet by token usage times a configurable price table. Budget level drives strategy: Growth, Normal, Survival, Critical.

Built for the Meta Global AI Developer Hackathon (Indie developer track, theme: Build for Your World).

## Setup

Follow these steps in order. A stranger with a fresh clone can finish them in about five minutes.

### 1. Prerequisites

1. Node.js 18 or newer. Check with `node --version`.
2. Nothing else. The app has zero npm dependencies and uses a JSON file store, so there is no database to install.
3. A Meta Model API key. Required: without a key the app refuses to run any mission or CEO cycle.
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

### 3. The app does nothing until a key is set

There is no demo mode in this app. Demo mode was removed: earlier versions could run on fake local output, and that path is gone.

Until a Meta Model API key is configured, the app boots, shows the setup screen and Settings, and refuses real work: submitting a mission or running a CEO cycle returns the error `No API key configured. Add one in Settings.` and creates no tasks and no charges.

Set the key in Settings (step 4) or by env var (step 5). From then on the CEO and worker agents call the Meta Model API: Muse Wonder for the CEO and heavy work, the Muse Spark series for light tasks. If a model call fails, the affected task is marked FAILED with the real error stored on the task. There is no fallback output.

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

To remove the key, delete `data/secrets.json` and restart. The app then refuses missions and CEO cycles again until a new key is set.

### 5. API key by env var (alternative)

Instead of Settings, start the server with env vars:

```bash
META_MODEL_API_KEY=your-key-here npm start
```

Optional: `META_MODEL_API_BASE` overrides the base URL, `META_MODEL_WONDER` and `META_MODEL_SPARK` override the model names. The Settings file wins when both are set, because Settings is the later, explicit choice. Env vars are the fallback at startup.

### 6. Muse adapter configuration

Builder-type sub-tasks (coding work) can run through a Muse adapter instead of the model API. The CEO decomposer tags coding sub-tasks with runtime `muse-code` and all others with runtime `model-api`. The employee roster shows each employee's runtime.

Configure it in the **Settings** card, or by env:

1. **Enable toggle**: the Settings checkbox "Enable Muse". Off means builder tasks cannot run through Muse; leave it on if you want coding tasks executed by the local tool.
2. **Command**: the Settings field "Muse command", env `MUSE_CODE_CMD`, default `muse`. The binary is named `muse`. Install it with the official script: `curl -fsSL https://dev.meta.ai/install.sh | bash` (installs to `~/.local/bin/muse`). The server looks the binary up on PATH and in `~/.local/bin`, where the installer puts it. Sign-in is separate from this app: use browser sign-in, or set the `META_API_KEY` env var for non-interactive runs.
3. **Args template**: the Settings field "Args template". The placeholder `{prompt}` is replaced with the task brief. Example shape: `--print {prompt}`. This is a template, not a fixed command, so you can match your installed version.
4. **Version or no-op arg**: optional, used only by the Test button. Empty means the test checks binary existence on PATH and runs nothing. Set it, for example to `--version`, if you want the test to also execute the tool once.
5. **Flat estimate**: Settings fields for flat estimate tokens in and out. When a Muse run reports usage in its output, the ledger records the reported usage. When it reports nothing, the ledger records this flat estimate and the task is labeled as an estimate.

Honest limits, read before you rely on this:

- The binary name is confirmed: `muse`, installed via the official script above. The exact headless invocation (args template) is still to be confirmed against the Muse Code documentation. The args default in this repo is a placeholder to verify, not a documented fact. Non-interactive runs use the `META_API_KEY` env var; interactive use signs in through the browser.
- The adapter spawns the configured command in a per-task working directory under `data/workdirs/<taskId>`, passes the brief through the args template, and captures stdout and stderr as the worker output.
- If the binary is missing, disabled, or exits non-zero, the task is marked FAILED and the real reason is stored on the task and shown on its card. No output is produced for that task. A real run is never faked.
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

The smoke test boots the real server on a throwaway data file and checks: company setup without a key; a mission and a CEO cycle with no key both refused with `No API key configured. Add one in Settings.` and zero missions and zero tasks created; a manual expense moving the company into Survival with the revenue task on top and a revenue approval created; revenue crediting the wallet; a fake API key saved through the settings API and read back masked only (the fake key is used only for that masking check, never for a model call); a mission with the key pointed at a dead local base URL failing honestly with zero tasks created; the Muse adapter returning unavailable with the real reason for both a missing binary and a non-zero exit; the secrets file permissions; and its `.gitignore` coverage. A passing run ends with `SMOKE OK - all checks passed`. The captured output of the latest run is in `smoke-output.txt`.

## Architecture

Five parts, matching the HLD:

1. **Web UI** (`public/index.html`): one page. Setup screen, CEO home, Settings. Polls `/api/board` every 2 seconds.
2. **Server** (`src/server.js`): plain Node `http`. API plus static UI. No framework, no dependencies.
3. **CEO engine** (`src/engine.js`): mission decomposition, worker runs, budget rules, priority scoring (Value, Urgency, Revenue, Cost) with budget-triggered re-rank, approval gates as a state machine, and the proactive CEO cycle.
4. **Model layer** (`src/models.js`): calls to the Meta Model API. With no key configured, decomposition and worker calls throw `No API key configured. Add one in Settings.` and nothing runs.
5. **Muse adapter** (`src/integrations/museCode.js`): configurable subprocess runner for builder tasks. A missing binary or non-zero exit fails the task with the real reason.
6. **Store** (`src/store.js`): one JSON file at `data/store.json`. State lives outside the models, so a restart loses nothing. Settings and secrets live in `src/settings.js` and `data/secrets.json`.

Data model: companies, agents (with runtime), missions, tasks, approvals, ledger, priority queue, activity feed.

## API summary

| Method and path | What it does |
|---|---|
| `GET /api/board` | Full board state: company, budget, agents, tasks, approvals, ledger, queue, activity |
| `POST /api/company` | Create the company and its CEO |
| `POST /api/mission` | Give the CEO a mission. Runs decomposition and workers, stops at the approval gate |
| `POST /api/approvals/:id` | Decide an approval: `{ "decision": "approve" }` or `"reject"` |
| `POST /api/spend` | Record a manual expense in the ledger (bookkeeping entry, not an agent run) |
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
5. The store is a JSON file. It is the right size for a hackathon build, not for production load.
6. No offline mode. The app needs a Meta Model API key to do any agent work, and Muse on the machine to run coding tasks.
