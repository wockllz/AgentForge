/**
 * AgentForge — LIVE FORGE DEMO.
 * Runs a REAL mission against the running AgentForge server (npm start),
 * with your real Ollama model, narrating every step in the console.
 * Patient timeouts — built for slow machines. No mocks.
 *
 * Usage (two terminals):
 *   npm start                      ← terminal 1: dashboard must be running
 *   npm run demo                   ← terminal 2: forges the demo app
 *   npm run demo -- "your idea"    ← custom prompt
 *   AF_URL=http://localhost:4301 npm run demo   ← non-default port
 */
"use strict";

const SERVER = process.env.AF_URL || "http://localhost:4300";
const DEFAULT_PROMPT = "a neon-styled pomodoro timer with a task list and dark mode";
const MISSION_BUDGET_MS = 10 * 60 * 1000; // 10 minutes — slow PCs welcome
const POLL_MS = 2000;

const clock = () => new Date().toLocaleTimeString([], { hour12: false });
const line = (msg) => process.stdout.write(`[${clock()}] ${msg}\n`);

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  let body = {};
  try { body = await res.json(); } catch { /* empty */ }
  return { status: res.status, body };
}

const AGENT_LABEL = { atlas: "ATLAS   ", pixel: "PIXEL   ", sentinel: "SENTINEL", system: "SYSTEM  " };

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim() || DEFAULT_PROMPT;

  line("=".repeat(60));
  line("AGENTFORGE — LIVE FORGE DEMO  (real model, real pipeline, no mocks)");
  line("=".repeat(60));

  // [1/5] server -----------------------------------------------------------
  line("[1/5] Checking AgentForge server…");
  let health;
  try {
    health = await getJson(`${SERVER}/api/health`);
  } catch {
    health = null;
  }
  if (!health || health.status !== 200 || !health.body.ok) {
    line("[1/5] ✗ Server not reachable at " + SERVER);
    line("      → Open a SECOND PowerShell window, run:  npm start");
    line("      → Keep it running, then run this demo again.");
    process.exit(1);
  }
  line("[1/5] ✓ Server online (" + (health.body.name || "AgentForge") + ")");

  // [2/5] model ------------------------------------------------------------
  line("[2/5] Checking Ollama and picking a model…");
  const { body: ollama } = await getJson(`${SERVER}/api/ollama/status`);
  if (!ollama.online || !ollama.models || !ollama.models.length) {
    line("[2/5] ✗ Ollama offline or no models installed.");
    line("      → Make sure Ollama is running, then:  ollama pull qwen2.5-coder:3b");
    process.exit(1);
  }
  const model = ollama.models.find((m) => m.includes("coder")) || ollama.models[0];
  line(`[2/5] ✓ Ollama online — models: ${ollama.models.join(", ")}`);
  line(`[2/5] ✓ Selected: ${model}`);

  // [3/5] forge ------------------------------------------------------------
  line(`[3/5] Forging: "${prompt}"`);
  const t0 = Date.now();
  const created = await getJson(`${SERVER}/api/missions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model })
  });
  if (created.status !== 201 || !created.body.ok) {
    line("[3/5] ✗ Mission rejected: " + JSON.stringify(created.body));
    process.exit(1);
  }
  const missionId = created.body.missionId;
  line(`[3/5] ✓ Mission accepted: ${missionId.slice(0, 8)}…`);
  line("[4/5] Live agent feed — (watch the dashboard too, same mission)");
  line("");

  // [4/5] narrate ----------------------------------------------------------
  let lastEvent = 0;
  let lastStatus = null;
  let heartbeat = 0;
  let final = null;

  while (Date.now() - t0 < MISSION_BUDGET_MS) {
    const { body } = await getJson(`${SERVER}/api/missions/${missionId}`);
    const mission = body.mission;

    if (mission.status !== lastStatus) {
      lastStatus = mission.status;
      line(`[${clock()}] STATUS → ${mission.status.toUpperCase()}`);
    }

    for (let i = lastEvent; i < body.events.length; i += 1) {
      const ev = body.events[i];
      const label = AGENT_LABEL[ev.agent] || ev.agent;
      if (ev.type === "check" && ev.data && typeof ev.data.ok === "boolean") {
        line(`  ${label} ${ev.data.ok ? "✓ PASS" : "✗ FAIL"} — ${ev.message}`);
      } else {
        line(`  ${label} ${ev.message}`);
      }
    }
    lastEvent = body.events.length;

    if (mission.status === "complete" || mission.status === "failed") {
      final = body;
      break;
    }

    heartbeat += POLL_MS;
    if (heartbeat >= 20000) {
      heartbeat = 0;
      line(`[${clock()}] … still working (${Math.round((Date.now() - t0) / 1000)}s elapsed, status: ${mission.status}) — slow machines are fine, keep waiting`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  if (!final) {
    line(`✗ Mission did not finish within 10 minutes. It may still be running — check the dashboard.`);
    process.exit(1);
  }

  // [5/5] summary ----------------------------------------------------------
  const m = final.mission;
  const checks = final.events.filter((e) => e.type === "check" && e.data && typeof e.data.ok === "boolean");
  const passed = checks.filter((e) => e.data.ok).length;
  const failed = checks.length - passed;
  const secs = Math.round((m.duration_ms || Date.now() - t0) / 1000);

  line("");
  line("=".repeat(60));
  if (m.status === "complete") {
    line(`[5/5] ✓ MISSION COMPLETE in ${secs}s — attempts: ${m.attempts}`);
    const files = Object.entries(final.files || {})
      .map(([name, content]) => `${name} (${(content.length / 1024).toFixed(1)} KB)`)
      .join(", ");
    line(`[5/5] ✓ Forged files: ${files || "none"}`);
    line(`[5/5] ✓ SENTINEL checks: ${passed} passed, ${failed} failed`);
    line(`[5/5] ✓ App name: ${m.app_name}`);
    line(`[5/5] ✓ Preview: ${SERVER}/p/${missionId}/index.html`);
    line("");
    line(`✅ AgentForge is fully operational on this machine. Time to record. ⚒️`);
    process.exit(0);
  }
  line(`[5/5] ✗ MISSION FAILED after ${m.attempts} attempt(s) — see feed above.`);
  process.exit(1);
}

main().catch((err) => {
  line("demo crashed: " + err.message);
  process.exit(1);
});
