/**
 * AgentForge — end-to-end self test.
 * Boots a mock Ollama server, starts the real AgentForge server pointed
 * at it, forges an app over the real HTTP API, and asserts:
 *   1. the happy path produces a mission with status "complete"
 *   2. the generated preview is actually served
 *   3. the SENTINEL retry loop repairs a deliberately broken build
 *
 * Run: npm run selftest        (happy path)
 *      MOCK_FAIL_ONCE=1 npm run selftest   (also proves the retry loop)
 */
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP_PORT = 4390;
const MOCK_PORT = 11500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`${label} did not come up within ${timeoutMs}ms`);
}

async function forgeApp(base) {
  const res = await fetch(`${base}/api/missions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "a pomodoro timer with a task list",
      model: "mock-coder:7b"
    })
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`mission create failed: ${JSON.stringify(body)}`);
  return body.missionId;
}

async function waitForMission(base, missionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/missions/${missionId}`);
    const body = await res.json();
    if (body.mission.status === "complete" || body.mission.status === "failed") {
      return body;
    }
    await sleep(300);
  }
  throw new Error("mission did not finish in time");
}

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}`);
  }
}

async function main() {
  let exitCode = 1;
  const failOnce = process.env.MOCK_FAIL_ONCE === "1";
  console.log(failOnce
    ? "== selftest (with forced build failure — retry loop must repair it) =="
    : "== selftest (happy path) ==");

  const mock = spawn(process.execPath, [path.join(__dirname, "mock-ollama.js")], {
    env: { ...process.env, MOCK_PORT: String(MOCK_PORT), MOCK_FAIL_ONCE: failOnce ? "1" : "0" },
    stdio: "inherit"
  });

  const app = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      OLLAMA_URL: `http://127.0.0.1:${MOCK_PORT}`,
      // point the data+generated dirs away from any dev copies
      AF_TEST: "1"
    },
    stdio: "inherit"
  });

  try {
    const base = `http://127.0.0.1:${APP_PORT}`;
    await waitFor(`${base}/api/health`, 15000, "AgentForge server");
    console.log("  ✓ server up");

    const ollama = await (await fetch(`${base}/api/ollama/status`)).json();
    assert(ollama.online === true, "sees the (mock) Ollama backend");
    assert(Array.isArray(ollama.models) && ollama.models.length > 0, "lists available models");

    const missionId = await forgeApp(base);
    console.log(`  ✓ mission accepted: ${missionId.slice(0, 8)}…`);

    const result = await waitForMission(base, missionId, 90000);
    assert(result.mission.status === "complete", "mission completes");
    assert(result.mission.attempts >= 1, `builder attempts recorded (${result.mission.attempts})`);
    if (failOnce) {
      assert(result.mission.attempts >= 2, "retry loop engaged after the broken first attempt");
    }

    const preview = await fetch(`${base}/p/${missionId}/index.html`);
    assert(preview.status === 200, "preview is served");
    const html = await preview.text();
    assert(html.includes("<title>Pomodoro Forge</title>"), "preview contains the forged HTML");
    assert(html.includes('src="app.js"'), "preview wires up app.js");

    const js = await (await fetch(`${base}/p/${missionId}/app.js`)).text();
    assert(js.includes("addEventListener"), "generated JS has real event handlers");

    const events = result.events.filter((e) => e.agent === "sentinel" && e.type === "check");
    assert(events.length > 0, "SENTINEL logged real verification checks");
    assert(result.files["index.html"].length > 0, "index.html available via API");
    assert(result.files["app.js"].length > 0, "app.js available via API");

    console.log("");
    if (failures === 0) {
      exitCode = 0;
      console.log("== selftest PASSED — AgentForge is fully operational ⚒️ ==");
    } else {
      console.log(`== selftest FAILED — ${failures} assertion(s) failed ==`);
      exitCode = 1;
    }
  } finally {
    mock.kill();
    app.kill();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("selftest crashed:", err.message);
  process.exit(1);
});
