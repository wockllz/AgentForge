# ⚒️ AgentForge

**An autonomous AI engineering team that plans, builds, and verifies real web apps — live, on your machine.**

Give ATLAS, PIXEL and SENTINEL a one-line idea, and watch them plan the build, write the entire application, run a real verification suite on their own output, repair what fails, and deploy a working, previewable app — all streamed to a mission-control dashboard in real time.

Runs **100% locally** on [Ollama](https://ollama.com). No cloud APIs, no API keys, no cost per mission.

---

## 🎬 What a mission looks like

1. You type an idea — *"a pomodoro timer with a task list and dark mode"*
2. **ATLAS (Planner)** turns it into a structured build plan (phases + tasks)
3. **PIXEL (Builder)** streams the entire app as it writes it — HTML, CSS, JS, watching the code appear live
4. **SENTINEL (Verifier)** runs a real verification suite against the build:
   - files exist and are non-trivial
   - HTML parses, has a `<title>`, wires up its stylesheet and script
   - **every JavaScript file passes `node --check`** (actual syntax validation)
   - no `...` placeholders left behind
5. If SENTINEL finds problems, **PIXEL is sent back with the failure report** and the loop retries (up to 3 attempts)
6. On success the app is deployed to a live preview URL — open it, click around, download the files

Everything is streamed to the dashboard over **Server-Sent Events**: agent chatter, verification check results, and the raw token stream from the model.

## 🧠 Why the verification layer is the point

Most "AI builds an app" demos just dump an LLM's output on screen and hope it works. AgentForge **treats the model's output as untrusted**: it parses it, validates it with deterministic tooling, feeds failures back into the build loop, and only deploys what passes. That loop — generate → verify → repair — is the same discipline real engineering teams use, applied to an AI agent pipeline.

## 🏗️ Architecture

```
┌────────────────────────── Mission Control (SSE) ──────────────────────────┐
│                                                                           │
│  POST /api/missions ──► engine.run()                                       │
│        │                        │                                          │
│        │                   ┌────▼─────┐   plan JSON    ┌────────────┐      │
│        │                   │  ATLAS   │──────────────►  │  SQLite    │      │
│        │                   │ (planner)│                  │  missions  │      │
│        │                   └────┬─────┘                  │  events    │      │
│        │                        │ build prompt            └────────────┘      │
│        │                   ┌────▼─────┐  index.html                          │
│  SSE ◄─┼───────────────────│  PIXEL   │  style.css                          │
│        │                   │ (builder)│  app.js      ┌────────────┐          │
│        │                   └────┬─────┘              │ generated/ │──► /p/:id │
│        │                        │ files             │  (sandbox)  │  preview │
│        │                   ┌────▼──────┐            └────────────┘          │
│        │                   │ SENTINEL  │  pass ──► deploy                   │
│        │                   │ (verifier)│  fail ──► PIXEL retries             │
│        │                   └───────────┘                                     │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Node.js + Express** server, **SQLite** (better-sqlite3) persistence
- **SSE** live streaming (agent events + raw model tokens)
- **Generated apps are sandboxed**: served read-only from `generated/`, previewed in a sandboxed iframe, never executed server-side
- Robust output parsing: survives models that wrap code/JSON in fences, prose, or both

## 🚀 Quickstart (complete setup — follow every step)

### Step 0 — Install Node.js (skip if you already have it)

Download the **LTS** installer from <https://nodejs.org> and run it (next-next-finish is fine).
Check it in a terminal / PowerShell:

```bash
node -v      # should print v18.x or higher
npm -v
```

### Step 1 — Install Ollama (the local AI engine)

Ollama runs the language model on your own machine. Free, no account, no API key.

- **Windows:** download the installer from <https://ollama.com/download/windows> and run it. That's it — Ollama starts automatically and lives in your system tray.
- **macOS:** `brew install ollama` or download from <https://ollama.com/download/mac>
- **Linux:** `curl -fsSL https://ollama.com/install.sh | sh`

Check it's alive:

```bash
ollama --version
```

> **Keep Ollama running.** On Windows it runs in the background automatically (check the system tray for the Ollama icon). If the dashboard later says `OLLAMA: OFFLINE`, Ollama isn't running — start it with `ollama serve` or relaunch the app.

### Step 2 — Download a code model (the agents' brain)

AgentForge's agents think with whatever model you give them. For writing code, Qwen Coder is the best small local model — this is the recommended setup:

```bash
ollama pull qwen2.5-coder:7b
```

This downloads ~4.7 GB, so give it a few minutes (progress bar shows while it downloads).

**Hardware guide:**
| Your machine | Model to pull | Command |
|---|---|---|
| 16 GB RAM or more (recommended) | Qwen2.5 Coder 7B — best quality apps | `ollama pull qwen2.5-coder:7b` |
| 8 GB RAM | Qwen2.5 Coder 3B — still good | `ollama pull qwen2.5-coder:3b` |
| 4 GB RAM / older laptop | Llama 3.2 3B — simpler apps, works fine | `ollama pull llama3.2:3b` |

Verify the model landed:

```bash
ollama list
# NAME                    SIZE
# qwen2.5-coder:7b        4.7 GB
```

> Whichever models appear in `ollama list` show up in the AgentForge dashboard's MODEL dropdown — you pick the brain per mission.

### Step 3 — Get AgentForge and launch mission control

```bash
git clone https://github.com/wockllz/AgentForge.git
cd AgentForge
npm install
npm start
```

Then open **http://localhost:4300** in your browser.

### Step 4 — Forge your first app

1. Check the top bar says `OLLAMA: ONLINE` (if OFFLINE, see Step 1)
2. Pick your model in the MODEL dropdown (e.g. `qwen2.5-coder:7b`)
3. Type an idea — e.g. *"a pomodoro timer with a task list and dark mode"*
4. Hit **⚒️ FORGE APP** and watch ATLAS plan, PIXEL code (live stream), and SENTINEL verify
5. When the mission completes, hit **↗ OPEN PREVIEW** — the app the agents built is really running

First mission takes a few minutes on 7B models — that's your CPU/GPU generating real code token by token. Watch the LIVE CODESTREAM panel; that's the model actually writing.

### 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| `OLLAMA: OFFLINE` in the top bar | Ollama isn't running. Windows: check the system tray. Or run `ollama serve` in a terminal and refresh the dashboard. |
| MODEL dropdown is empty | You haven't pulled a model. Run `ollama pull qwen2.5-coder:7b`, wait for it to finish, refresh. |
| Mission stuck on PLANNING for ages | Small models think slowly on CPU. Wait (up to ~5 min) or pull a smaller model. Don't forge two missions at once on weak hardware. |
| Mission fails after 3 attempts | Some ideas are too big for one page. Try a shorter, simpler prompt ("a quiz app with 5 questions" works great on 7B). |
| `port 4300 in use` | Something else owns the port: `PORT=4301 npm start` (Windows PowerShell: `$env:PORT=4301; npm start`). |

**No Ollama at all?** The dashboard still loads and shows the connection status — but missions need a model, so do Steps 1–2 first. You can also prove the engine works without any model: `npm run selftest`.

## 🧪 Self-test (no Ollama required)

AgentForge ships with an end-to-end test harness: a mock Ollama server plus a real HTTP integration test that forges an app through the actual pipeline and asserts on the results.

```bash
npm run selftest                      # happy path: 13 assertions
MOCK_FAIL_ONCE=1 npm run selftest     # also proves the SENTINEL retry loop:
                                      # attempt 1 ships broken JS → caught → repaired → complete
```

The self-test proves: mission lifecycle, file generation, real JS syntax verification, the retry loop, preview serving, and the API — without needing a real model.

## 📡 API

| Method | Route | What it does |
|---|---|---|
| `GET` | `/api/health` | Server health |
| `GET` | `/api/ollama/status` | Ollama connection + available models |
| `GET` | `/api/missions` | Recent missions |
| `POST` | `/api/missions` | Start a mission: `{ prompt, model }` |
| `GET` | `/api/missions/:id` | Mission + full event log + files |
| `GET` | `/api/missions/:id/files` | Generated files |
| `GET` | `/api/stream/:id` | **SSE** live event + token stream |
| `GET` | `/p/:missionId/*` | Read-only preview of the forged app |

## 🔒 Design notes

- **Local-first.** Your ideas and generated code never leave your machine.
- **Untrusted output, validated.** Generated JS is syntax-checked with `node --check`, never executed server-side. Previews render in a sandboxed iframe.
- **Resilient parsing.** Small local models produce messy output; AgentForge recovers code blocks and JSON from prose, falls back to safe defaults, and retries.
- **Path-safe previews.** The preview server normalises paths and rejects traversal outside the mission's sandbox.

## 🗺️ Roadmap

- [ ] Multi-file apps beyond the single-page trio
- [ ] SENTINEL headless browser smoke tests on forged apps
- [ ] Mission memory: SENTINEL lessons carried into PIXEL's next build
- [ ] Streaming diffs in the code viewer

## 📄 License

MIT

---

**Built by [Ntshuxeko Sambo](https://github.com/wockllz)** — full-stack developer building real things with local AI. Also see [ShopSphere](https://github.com/wockllz/ShopSphere), [SocialSphere](https://github.com/wockllz/SocialSphere) and [TaskFlow](https://github.com/wockllz/TaskFlow).
