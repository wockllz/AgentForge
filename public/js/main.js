/**
 * AgentForge — mission control frontend (v2).
 * Vanilla JS. Live 3D forge stage, stage-stepper, ATLAS mission brief,
 * timeline feed, code panes — all driven over Server-Sent Events.
 */
"use strict";

(function () {
  const $ = (id) => document.getElementById(id);

  const AGENTS = [
    { id: "atlas", name: "ATLAS", role: "PLANNER", desc: "Briefs the mission, sets the design direction" },
    { id: "pixel", name: "PIXEL", role: "BUILDER", desc: "Writes the entire app: HTML, CSS, JS" },
    { id: "sentinel", name: "SENTINEL", role: "VERIFIER", desc: "Runs real checks, forces revisions" }
  ];

  const STAGES = {
    queued: null,
    planning: "planning",
    building: "building",
    revision: "building",
    verifying: "verifying",
    complete: "complete",
    failed: null
  };

  const state = {
    missions: [],
    activeId: null,
    stream: null,
    liveBuffer: "",
    planPhases: [],
    checks: { pass: 0, fail: 0 }
  };

  // ---------------------------------------------------------------- render

  function renderAgents(activeAgent) {
    $("agents").innerHTML = AGENTS.map((a) => {
      const active = a.id === activeAgent;
      return (
        '<div class="agent-row' + (active ? " active" : "") + '" data-agent="' + a.id + '">' +
          '<span class="agent-dot"></span>' +
          '<div class="agent-info"><strong>' + a.name + '</strong>' +
          '<small>' + a.role + " — " + a.desc + '</small></div>' +
          '<span class="agent-state">' + (active ? "WORKING" : "IDLE") + "</span>" +
        "</div>"
      );
    }).join("");
    if (window.AgentViz) window.AgentViz.setActive(activeAgent || null);
  }

  function setPill(status) {
    const pill = $("mission-pill");
    pill.textContent = status ? status.toUpperCase() : "STANDBY";
    pill.className = "mission-pill" +
      (["planning", "building", "revision", "verifying", "queued"].includes(status) ? " live" : "") +
      (status === "complete" ? " complete" : "") +
      (status === "failed" ? " failed" : "");
  }

  function setStage(status) {
    const target = STAGES[status] || null;
    const order = ["planning", "building", "verifying", "complete"];
    const targetIdx = target ? order.indexOf(target) : -1;
    $("stage-stepper").querySelectorAll(".stage").forEach((el) => {
      const stage = el.dataset.stage;
      const idx = order.indexOf(stage);
      el.classList.remove("active", "done");
      if (target === null) return;
      if (idx < targetIdx) el.classList.add("done");
      else if (idx === targetIdx) el.classList.add(target === "complete" ? "done" : "active");
    });
  }

  function renderHistory() {
    const wrap = $("mission-history");
    if (!state.missions.length) {
      wrap.innerHTML = '<div class="empty">No missions yet. Forge your first app.</div>';
      return;
    }
    wrap.innerHTML = state.missions.map((m) => {
      const badge = ["complete", "failed", "queued"].includes(m.status) ? m.status : m.status;
      return (
        '<div class="mission-row' + (m.id === state.activeId ? " active" : "") +
          '" data-id="' + m.id + '">' +
          '<span class="mr-prompt"></span>' +
          '<span class="mission-badge ' + badge + '">' + m.status.toUpperCase() + "</span>" +
        "</div>"
      );
    }).join("");
    const rows = wrap.querySelectorAll(".mission-row");
    rows.forEach((row, i) => {
      row.querySelector(".mr-prompt").textContent = state.missions[i].prompt;
      row.addEventListener("click", () => selectMission(state.missions[i].id));
    });
  }

  function addFeedRow(ev) {
    const feed = $("feed");
    const hint = feed.querySelector(".feed-hint");
    if (hint) hint.remove();

    const row = document.createElement("div");
    let cls = "feed-row";
    if (ev.type === "thought") cls += " thought";
    if (ev.type === "check" && ev.data && typeof ev.data.ok === "boolean") {
      cls += ev.data.ok ? " check-pass" : " check-fail";
      if (state.activeId) {
        if (ev.data.ok) state.checks.pass += 1;
        else state.checks.fail += 1;
      }
    }
    row.className = cls;

    const time = document.createElement("span");
    time.className = "feed-time";
    time.textContent = new Date(ev.ts).toLocaleTimeString([], { hour12: false });

    const agent = document.createElement("span");
    agent.className = "feed-agent " + ev.agent;
    agent.textContent = ev.agent.toUpperCase();

    const msg = document.createElement("span");
    msg.className = "feed-msg";
    msg.textContent = (ev.type === "thought" ? "⟡ " : "") + ev.message;

    row.append(time, agent, msg);
    feed.append(row);
    feed.scrollTop = feed.scrollHeight;
    if (feed.children.length > 150) feed.removeChild(feed.firstChild);
  }

  function renderPlan(ev) {
    state.planPhases.push(ev.data);
    renderPlanPanel();
  }

  function renderPlanPanel() {
    const panel = $("plan-panel");
    panel.innerHTML = "";
    const mission = state.missions.find((m) => m.id === state.activeId);
    const meta = state.planMeta;
    if (!state.planPhases.length && !meta) {
      panel.innerHTML = '<div class="empty">No plan yet — ATLAS briefs here when a mission starts.</div>';
      return;
    }
    if (meta && meta.thinking) {
      const think = document.createElement("div");
      think.className = "plan-thinking";
      think.textContent = "ATLAS thinking: " + meta.thinking;
      panel.append(think);
    }
    if (meta && (meta.summary || meta.app_name)) {
      const sum = document.createElement("div");
      sum.className = "plan-summary";
      sum.innerHTML = "";
      const name = document.createElement("span");
      name.className = "plan-name";
      name.textContent = meta.app_name || "forged-app";
      const rest = document.createElement("span");
      rest.textContent = " — " + (meta.summary || "");
      sum.append(name, rest);
      panel.append(sum);
    }
    if (meta && meta.design_notes) {
      const notes = document.createElement("div");
      notes.className = "design-notes";
      Object.entries(meta.design_notes).forEach(([k, v]) => {
        const n = document.createElement("span");
        n.className = "design-note";
        n.textContent = k + ": " + v;
        notes.append(n);
      });
      panel.append(notes);
    }
    state.planPhases.forEach((phase, i) => {
      const card = document.createElement("div");
      card.className = "phase-card";
      const name = document.createElement("div");
      name.className = "phase-name";
      name.textContent = (i + 1) + ". " + phase.name;
      const ul = document.createElement("ul");
      (phase.tasks || []).forEach((task) => {
        const li = document.createElement("li");
        li.textContent = task;
        ul.append(li);
      });
      card.append(name, ul);
      panel.append(card);
    });
  }

  function renderFiles(files) {
    const tabs = $("file-tabs");
    const view = $("code-view");
    const names = Object.keys(files);
    if (!names.length) return;
    tabs.innerHTML = "";
    names.forEach((name, i) => {
      const tab = document.createElement("span");
      tab.className = "file-tab" + (i === 0 ? " active" : "");
      tab.textContent = name;
      tab.addEventListener("click", () => {
        tabs.querySelectorAll(".file-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        view.textContent = files[name];
      });
      tabs.append(tab);
    });
    view.textContent = files[names[0]];
  }

  function showPreview(missionId, mission) {
    const zone = $("preview-zone");
    zone.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.src = "/p/" + missionId + "/index.html";
    frame.title = "Forged app preview";
    zone.append(frame);

    const meta = $("preview-meta");
    meta.innerHTML = "";
    if (mission) {
      const secs = mission.duration_ms ? Math.round(mission.duration_ms / 1000) : null;
      const line1 = document.createElement("div");
      line1.textContent = "APP: " + (mission.app_name || "forged-app") +
        "   |   ATTEMPTS: " + mission.attempts;
      const line2 = document.createElement("div");
      line2.textContent = "CHECKS: " + state.checks.pass + " passed" +
        (state.checks.fail ? " / " + state.checks.fail + " failed" : "") +
        (secs ? "   |   FORGED IN " + secs + "s" : "");
      line2.className = "meta-strong";
      meta.append(line1, line2);
    }

    $("preview-actions").classList.remove("hidden");
    $("preview-link").href = "/p/" + missionId + "/index.html";
    $("download-btn").onclick = () => downloadFiles(missionId);
  }

  function clearPanels() {
    state.planPhases = [];
    state.planMeta = null;
    state.checks = { pass: 0, fail: 0 };
    state.liveBuffer = "";
    $("feed").innerHTML = "";
    $("live-stream").textContent = "";
    $("code-view").textContent = "";
    $("file-tabs").innerHTML = "";
    $("plan-panel").innerHTML =
      '<div class="empty">No plan yet — ATLAS briefs here when a mission starts.</div>';
    $("preview-zone").innerHTML = '<div class="empty">Forging in progress…</div>';
    $("preview-meta").innerHTML = "";
    $("preview-actions").classList.add("hidden");
  }

  async function downloadFiles(missionId) {
    const res = await fetch("/api/missions/" + missionId + "/files");
    const body = await res.json();
    Object.entries(body.files).forEach(([name, content]) => {
      const blob = new Blob([content], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  // ---------------------------------------------------------------- streaming

  function openStream(missionId) {
    if (state.stream) {
      state.stream.close();
      state.stream = null;
    }
    state.liveBuffer = "";
    $("live-stream").textContent = "";
    renderAgents(null);

    const es = new EventSource("/api/stream/" + missionId);
    state.stream = es;

    es.onmessage = (frame) => {
      let payload;
      try {
        payload = JSON.parse(frame.data);
      } catch {
        return;
      }

      if (payload.kind === "event") {
        const ev = payload.event;
        addFeedRow(ev);
        if (ev.type === "plan") renderPlan(ev);
        if (ev.type === "brief") {
          state.planMeta = ev.data;
          renderPlanPanel();
        }
      } else if (payload.kind === "token") {
        renderAgents(payload.agent);
        state.liveBuffer = (state.liveBuffer + payload.token).slice(-4000);
        $("live-stream").textContent = state.liveBuffer;
      } else if (payload.kind === "status") {
        setPill(payload.status);
        setStage(payload.status);
        if (payload.status === "planning") renderAgents("atlas");
        if (payload.status === "building" || payload.status === "revision") renderAgents("pixel");
        if (payload.status === "verifying") renderAgents("sentinel");
        refreshMissions();
      } else if (payload.kind === "done") {
        es.close();
        state.stream = null;
        renderAgents(null);
        setPill(payload.ok ? "complete" : "failed");
        setStage(payload.ok ? "complete" : "failed");
        refreshMissions().then(() => {
          if (payload.ok) {
            loadMission(missionId);
          }
        });
      }
    };

    es.onerror = () => {
      const m = state.missions.find((x) => x.id === missionId);
      if (m && (m.status === "complete" || m.status === "failed")) es.close();
    };
  }

  async function loadMission(missionId) {
    const res = await fetch("/api/missions/" + missionId);
    if (!res.ok) return;
    const body = await res.json();
    state.activeId = missionId;

    clearPanels();
    setPill(body.mission.status);
    setStage(body.mission.status);

    // reconstruct panels from the event history
    body.events.forEach((ev) => {
      if (ev.type === "check" && ev.data && typeof ev.data.ok === "boolean") {
        if (ev.data.ok) state.checks.pass += 1;
        else state.checks.fail += 1;
      }
      if (ev.type === "brief") state.planMeta = ev.data;
      if (ev.type === "plan") state.planPhases.push(ev.data);
      addFeedRow(ev);
    });
    renderPlanPanel();
    renderFiles(body.files || {});
    renderHistory();

    if (body.mission.status === "complete") {
      showPreview(missionId, body.mission);
      renderAgents(null);
    } else if (body.mission.status !== "failed") {
      renderAgents(null);
      openStream(missionId);
    } else {
      renderAgents(null);
    }
  }

  function selectMission(id) {
    if (id === state.activeId) return;
    loadMission(id);
  }

  // ---------------------------------------------------------------- data

  async function refreshMissions() {
    const res = await fetch("/api/missions");
    const body = await res.json();
    state.missions = body.missions;
    $("mission-count").textContent = String(state.missions.length);
    renderHistory();
  }

  async function refreshOllama() {
    const el = $("ollama-status");
    const sel = $("model-select");
    try {
      const res = await fetch("/api/ollama/status");
      const body = await res.json();
      if (body.online) {
        el.textContent = "ONLINE";
        el.className = "status-value online";
        sel.innerHTML = "";
        if (body.models.length) {
          body.models.forEach((m, i) => {
            const opt = document.createElement("option");
            opt.value = m;
            opt.textContent = m;
            if (i === 0) opt.selected = true;
            sel.append(opt);
          });
          // prefer a coder model if present
          const coder = body.models.find((m) => m.includes("coder"));
          if (coder) sel.value = coder;
        } else {
          sel.innerHTML = '<option value="">no models — run `ollama pull qwen2.5-coder:7b`</option>';
        }
      } else {
        el.textContent = "OFFLINE";
        el.className = "status-value offline";
        sel.innerHTML = '<option value="">install Ollama first</option>';
      }
    } catch {
      el.textContent = "OFFLINE";
      el.className = "status-value offline";
    }
  }

  // ---------------------------------------------------------------- forge

  async function forge() {
    const prompt = $("prompt-input").value.trim();
    const model = $("model-select").value;
    const errBox = $("forge-error");
    errBox.textContent = "";

    if (prompt.length < 4) {
      errBox.textContent = "Describe the app you want first.";
      return;
    }
    if (!model) {
      errBox.textContent = "No Ollama model available — start Ollama and pull a model.";
      return;
    }

    const btn = $("forge-btn");
    btn.disabled = true;
    btn.querySelector(".forge-btn-label").textContent = "⚒️ FORGING…";

    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model })
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        errBox.textContent = body.error || "Mission could not be created.";
        return;
      }
      clearPanels();
      setPill("queued");
      await refreshMissions();
      loadMission(body.missionId);
    } catch (err) {
      errBox.textContent = "Request failed: " + err.message;
    } finally {
      btn.disabled = false;
      btn.querySelector(".forge-btn-label").textContent = "⚒️ FORGE APP";
    }
  }

  // ---------------------------------------------------------------- boot

  renderAgents(null);
  setStage("standby");
  refreshOllama();
  refreshMissions().then(() => {
    if (state.missions.length &&
      ["planning", "building", "revision", "verifying", "queued"].includes(state.missions[0].status)) {
      loadMission(state.missions[0].id);
    }
  });
  setInterval(refreshMissions, 8000);
  setInterval(refreshOllama, 20000);
  $("forge-btn").addEventListener("click", forge);
  $("prompt-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) forge();
  });
})();
