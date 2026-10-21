/**
 * AgentForge — mission control server.
 * Express app: REST API + Server-Sent Events live stream + generated-app previews.
 */
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");

const db = require("./src/db");
const ollama = require("./src/ollama");
const { MissionEngine, newMissionId, GENERATED_ROOT } = require("./src/agents/engine");

const app = express();
const PORT = process.env.PORT || 4300;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// SSE plumbing — one client registry per mission id.
// ---------------------------------------------------------------------------

const streamClients = new Map(); // missionId -> Set<res>

function addClient(missionId, res) {
  if (!streamClients.has(missionId)) streamClients.set(missionId, new Set());
  streamClients.get(missionId).add(res);
  res.on("close", () => {
    const set = streamClients.get(missionId);
    if (set) {
      set.delete(res);
      if (set.size === 0) streamClients.delete(missionId);
    }
  });
}

function broadcast(missionId, payload) {
  const set = streamClients.get(missionId);
  if (!set) return;
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try {
      res.write(frame);
    } catch {
      /* client vanished; close handler cleans up */
    }
  }
}

// Token throttling so a fast model cannot flood SSE buffers.
const tokenBuf = new Map(); // missionId -> {agent, buf, timer}
function broadcastToken(missionId, agent, token) {
  let entry = tokenBuf.get(missionId);
  if (!entry || entry.agent !== agent) {
    if (entry && entry.timer) {
      clearTimeout(entry.timer);
      flushTokens(missionId);
    }
    entry = { agent, buf: "", timer: null };
    tokenBuf.set(missionId, entry);
  }
  entry.buf += token;
  if (!entry.timer) {
    entry.timer = setTimeout(() => flushTokens(missionId), 60);
  }
}

function flushTokens(missionId) {
  const entry = tokenBuf.get(missionId);
  tokenBuf.delete(missionId);
  if (entry) {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.buf) broadcast(missionId, { kind: "token", agent: entry.agent, token: entry.buf });
  }
}

const engine = new MissionEngine({ db, broadcast, broadcastToken, flushTokens });

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "AgentForge" });
});

app.get("/api/ollama/status", async (_req, res) => {
  try {
    const models = await ollama.listModels();
    res.json({ online: true, models, url: ollama.OLLAMA_URL });
  } catch (err) {
    res.json({ online: false, models: [], url: ollama.OLLAMA_URL, error: err.message });
  }
});

app.get("/api/missions", (_req, res) => {
  res.json({ missions: db.listMissions() });
});

app.post("/api/missions", async (req, res) => {
  const prompt = String((req.body && req.body.prompt) || "").trim();
  const model = String((req.body && req.body.model) || "").trim();

  if (prompt.length < 4) {
    return res.status(400).json({ ok: false, error: "Describe the app you want in a few words." });
  }
  if (prompt.length > 600) {
    return res.status(400).json({ ok: false, error: "Keep the prompt under 600 characters." });
  }
  if (!model) {
    return res.status(400).json({ ok: false, error: "Pick an Ollama model first." });
  }

  const id = newMissionId();
  db.createMission({ id, prompt, model });
  res.status(201).json({ ok: true, missionId: id });

  // Run the pipeline in the background — the dashboard follows over SSE.
  engine.run(id).catch(() => {
    /* engine handles its own failures */
  });
});

app.get("/api/missions/:id", (req, res) => {
  const mission = db.getMission(req.params.id);
  if (!mission) return res.status(404).json({ ok: false, error: "Mission not found." });
  const missionFiles = readMissionFiles(req.params.id);
  res.json({ mission, events: db.listEvents(req.params.id), files: missionFiles });
});

app.get("/api/missions/:id/files", (req, res) => {
  res.json({ files: readMissionFiles(req.params.id) });
});

function readMissionFiles(missionId) {
  const dir = path.join(GENERATED_ROOT, missionId, "public");
  const files = {};
  for (const name of ["index.html", "style.css", "app.js"]) {
    try {
      files[name] = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      /* not generated yet */
    }
  }
  return files;
}

// SSE live stream for one mission
app.get("/api/stream/:id", (req, res) => {
  const mission = db.getMission(req.params.id);
  if (!mission) return res.status(404).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("\n");
  addClient(req.params.id, res);
  if (mission.status === "complete" || mission.status === "failed") {
    broadcast(req.params.id, { kind: "done", ok: mission.status === "complete" });
  }
});

// ---------------------------------------------------------------------------
// Generated app previews — served read-only from the generated/ sandbox.
// ---------------------------------------------------------------------------

app.get("/p/:missionId", (req, res) => {
  res.redirect(`/p/${req.params.missionId}/index.html`);
});

app.use("/p/:missionId", (req, res) => {
  const dir = path.join(GENERATED_ROOT, req.params.missionId, "public");
  const requested = path.normalize(req.path).replace(/^([/\\])+/, "");
  if (!requested || requested.includes("..")) {
    return res.status(400).send("Bad path");
  }
  const file = path.join(dir, requested);
  if (!file.startsWith(dir)) {
    return res.status(400).send("Bad path");
  }
  const types = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  };
  const ext = path.extname(file).toLowerCase();
  if (!types[ext]) return res.status(415).send("Unsupported type");
  try {
    res.type(types[ext]).send(fs.readFileSync(file));
  } catch {
    res.status(404).send("Not found — this mission has no preview yet.");
  }
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

app.get("/", (_req, res) => {
  res.render("index", { missions: db.listMissions() });
});

app.use((_req, res) => {
  res.status(404).render("index", { missions: db.listMissions() });
});

app.listen(PORT, () => {
  console.log("");
  console.log("  ⚒️  AgentForge — mission control online");
  console.log(`  →  http://localhost:${PORT}`);
  console.log(`  →  Ollama: ${ollama.OLLAMA_URL}`);
  console.log("");
});
