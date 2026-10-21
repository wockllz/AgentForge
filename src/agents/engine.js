/**
 * AgentForge — the mission engine.
 * Orchestrates the ATLAS → PIXEL → SENTINEL loop for one mission,
 * emitting every step as a streamable event.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ollama = require("../ollama");
const { planPrompt, buildPrompt, reviewPrompt } = require("../prompts");
const { extractCodeBlocks, toFileSet, extractJson, defaultPlan } = require("../extract");
const sentinel = require("./sentinel");

const GENERATED_ROOT = path.join(__dirname, "..", "..", "generated");
const MAX_BUILD_ATTEMPTS = 3;

class MissionEngine {
  constructor({ db, broadcast, broadcastToken, flushTokens }) {
    this.db = db;
    this.broadcast = broadcast;         // (missionId, payload) => void
    this.broadcastToken = broadcastToken; // (missionId, agent, token) => void
    this.flushTokens = flushTokens || (() => {});
  }

  emit(missionId, agent, type, message, data) {
    const event = this.db.addEvent(missionId, agent, type, message, data);
    this.broadcast(missionId, { kind: "event", event });
    return event;
  }

  setStatus(missionId, status) {
    this.db.updateMission(missionId, { status });
    this.broadcast(missionId, { kind: "status", status });
  }

  /**
   * Full mission pipeline. Never throws — failures become mission events.
   */
  async run(missionId) {
    const started = Date.now();
    const mission = this.db.getMission(missionId);

    try {
      // ---------- ATLAS: planning ----------
      this.setStatus(missionId, "planning");
      this.emit(missionId, "atlas", "chat", "Analysing the request and drafting a build plan…");

      const plan = await this.planPhase(mission);
      this.db.updateMission(missionId, {
        plan: JSON.stringify(plan.plan),
        app_name: plan.plan.app_name
      });

      // mission brief: ATLAS's reasoning + design direction, streamed to the dashboard
      this.emit(missionId, "atlas", "brief", "Mission brief locked.", {
        thinking: plan.plan.thinking || null,
        app_name: plan.plan.app_name,
        summary: plan.plan.summary,
        design_notes: plan.plan.design_notes || null
      });
      if (plan.plan.thinking) {
        this.emit(missionId, "atlas", "thought", plan.plan.thinking);
      }

      for (const phase of plan.plan.phases) {
        this.emit(missionId, "atlas", "plan", phase.name, { tasks: phase.tasks });
      }
      this.emit(missionId, "atlas", "chat",
        `Plan locked: ${plan.plan.phases.length} phases, app name "${plan.plan.app_name}".`);

      // ---------- PIXEL + SENTINEL loop ----------
      let files = null;
      let report = null;
      let errors = [];

      for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt += 1) {
        this.db.updateMission(missionId, { attempts: attempt });
        this.setStatus(missionId, attempt === 1 ? "building" : "revision");
        this.emit(missionId, "pixel", "chat",
          attempt === 1
            ? "Writing the application code…"
            : `Revision attempt ${attempt}: fixing ${errors.length} issue(s) reported by SENTINEL…`, { errors });

        files = await this.buildPhase(mission, plan.plan, attempt, errors);

        this.setStatus(missionId, "verifying");
        this.emit(missionId, "sentinel", "chat", "Running verification suite on the generated app…");
        report = this.verifyPhase(missionId, files);

        if (report.ok) {
          break;
        }

        errors = report.errors;
        this.emit(missionId, "sentinel", "verdict", `Attempt ${attempt} failed verification.`, { errors });

        if (attempt === MAX_BUILD_ATTEMPTS) {
          this.emit(missionId, "sentinel", "verdict",
            "Max attempts reached — the last build still has issues. Marking mission as failed.");
        }
      }

      if (!report.ok) {
        this.db.updateMission(missionId, {
          status: "failed",
          error: report.errors.join(" | "),
          duration_ms: Date.now() - started
        });
        this.flushTokens(missionId);
        this.broadcast(missionId, { kind: "status", status: "failed" });
        this.broadcast(missionId, { kind: "done", ok: false });
        return;
      }

      // ---------- soft LLM review ----------
      try {
        await this.reviewPhase(mission, files);
      } catch {
        /* soft signal only — never fails the mission */
      }

      // ---------- deploy preview ----------
      const previewUrl = this.persist(missionId, files);
      this.emit(missionId, "sentinel", "deploy",
        "Preview deployed. The forged app is live.", { previewUrl });

      this.db.updateMission(missionId, { status: "complete", duration_ms: Date.now() - started });
      this.flushTokens(missionId);
      this.broadcast(missionId, { kind: "status", status: "complete" });
      this.broadcast(missionId, { kind: "done", ok: true, previewUrl });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      this.emit(missionId, "system", "error", `Mission aborted: ${message}`);
      this.db.updateMission(missionId, {
        status: "failed",
        error: message,
        duration_ms: Date.now() - started
      });
      this.flushTokens(missionId);
      this.broadcast(missionId, { kind: "status", status: "failed" });
      this.broadcast(missionId, { kind: "done", ok: false });
    }
  }

  // ------------------------------------------------------------------

  async planPhase(mission) {
    let raw = "";
    try {
      raw = await ollama.chatStream(
        mission.model,
        [{ role: "user", content: planPrompt(mission.prompt) }],
        (token) => this.broadcastToken(mission.id, "atlas", token),
        { temperature: 0.2 }
      );
    } catch (err) {
      this.emit(mission.id, "atlas", "error", `Planner call failed: ${err.message}`);
      throw err;
    }

    const parsed = extractJson(raw);
    if (parsed && parsed.phases && Array.isArray(parsed.phases) && parsed.phases.length) {
      this.emit(mission.id, "atlas", "chat", "Plan parsed successfully.");
      return { plan: parsed };
    }

    this.emit(mission.id, "atlas", "chat",
      "Plan JSON was malformed — falling back to the standard three-phase plan.");
    return { plan: defaultPlan(mission.prompt) };
  }

  async buildPhase(mission, plan, attempt, errors) {
    let raw = "";
    try {
      raw = await ollama.chatStream(
        mission.model,
        [{ role: "user", content: buildPrompt(mission.prompt, plan, attempt, errors) }],
        (token) => this.broadcastToken(mission.id, "pixel", token),
        { temperature: attempt > 1 ? 0.2 : 0.4 }
      );
    } catch (err) {
      this.emit(mission.id, "pixel", "error", `Builder call failed: ${err.message}`);
      throw err;
    }

    const blocks = extractCodeBlocks(raw);
    if (blocks.length === 0) {
      this.emit(mission.id, "pixel", "chat", "No code blocks detected in my output.");
      return { "index.html": "", "style.css": "", "app.js": "" };
    }

    const files = toFileSet(blocks);
    for (const [name, content] of Object.entries(files)) {
      this.emit(mission.id, "pixel", "file", `Wrote ${name} (${content.length} bytes)`, { name, bytes: content.length });
    }
    return files;
  }

  verifyPhase(missionId, files) {
    const report = sentinel.verify(files, ({ name, ok, detail }) => {
      this.emit(missionId, "sentinel", "check",
        `${ok ? "PASS" : "FAIL"} — ${name}: ${detail}`, { name, ok, detail });
    });

    if (report.ok) {
      this.emit(missionId, "sentinel", "verdict",
        `Verification passed — ${report.checks.length} checks green.`, { checks: report.checks });
    }
    return report;
  }

  async reviewPhase(mission, files) {
    const summary = Object.entries(files)
      .map(([name, content]) => `- ${name}: ${content.length} bytes`)
      .join("\n");

    const raw = await ollama.chat(
      mission.model,
      [{ role: "user", content: reviewPrompt(mission.prompt, summary) }],
      { temperature: 0.2 }
    );
    const review = extractJson(raw);

    if (review && typeof review.ok === "boolean") {
      this.db.addEvent(mission.id, "sentinel", "review",
        `SENTINEL review: ${review.ok ? "approved" : "has notes"} — ${review.notes || "no notes"}`, review);
      this.broadcast(mission.id, {
        kind: "event",
        event: this.db.listEvents(mission.id).slice(-1)[0]
      });
    }
  }

  persist(missionId, files) {
    const dir = path.join(GENERATED_ROOT, missionId, "public");
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content, "utf8");
    }
    return `/p/${missionId}/index.html`;
  }
}

function newMissionId() {
  return crypto.randomUUID();
}

module.exports = { MissionEngine, newMissionId, GENERATED_ROOT, MAX_BUILD_ATTEMPTS };
