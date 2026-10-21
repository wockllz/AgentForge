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

## 🚀 Quickstart

**Prerequisites:** [Node.js 18+](https://nodejs.org) and [Ollama](https://ollama.com) with a code-capable model.

```bash
# 1. get the code
git clone https://github.com/wockllz/AgentForge.git
cd AgentForge
npm install

# 2. pull a model (pick one)
ollama pull qwen2.5-coder:7b     # recommended — best small code model
ollama pull llama3.2:3b          # lighter, for modest hardware

# 3. launch mission control
npm start
# → http://localhost:4300
```

Describe an app, hit **⚒️ FORGE APP**, and watch the team work.

**No Ollama yet?** The dashboard still loads and shows the connection status — but missions need a model, so install Ollama first.

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
