/**
 * AgentForge — mission control frontend.
 * Vanilla JS. Follows missions live over Server-Sent Events.
 */
"use strict";

(function () {
  const $ = (id) => document.getElementById(id);

  const AGENTS = [
    { id: "atlas", name: "ATLAS", role: "PLANNER", desc: "Breaks the idea into a build plan" },
    { id: "pixel", name: "PIXEL", role: "BUILDER", desc: "Writes the entire app: HTML, CSS, JS" },
    { id: "sentinel", name: "SENTINEL", role: "VERIFIER", desc: "Runs real checks, forces revisions" }
  ];

  const state = {
    missions: [],
    activeId: null,
    activeAgent: null,
    stream: null,
    liveBuffer: "",
    done: {}
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
  }

  function statusLabel(m) {
    return m ? m.status.toUpperCase() : "STANDBY";
  }

  function renderHistory() {
    const wrap = $("mission-history");
    if (!state.missions.length) {
      wrap.innerHTML = '<div class="empty">No missions yet. Forge your first app.</div>';
      return;
    }
    wrap.innerHTML = state.missions.map((m) => {
      const badge = m.status === "complete" || m.status === "failed" ? m.status
        : (m.status === "queued" ? "queued" : m.status);
      return (
        '<div class="mission-row' + (m.id === state.activeId ? " active" : "") +
          '" data-id="' + m.id + '">' +
          '<span class="mr-prompt"></span>' +
          '<span class="mission-badge ' + badge + '">' + m.status.toUpperCase() + "</span>" +
        "</div>"
      );
    }).join("");
    // safe text fill (no innerHTML for user content)
    const rows = wrap.querySelectorAll(".mission-row");
    rows.forEach((row, i) => {
      row.querySelector(".mr-prompt").textContent = state.missions[i].prompt;
      row.addEventListener("click", () => selectMission(state.missions[i].id));
    });
  }

  function setPill(status) {
    const pill = $("mission-pill");
    pill.textContent = statusLabel({ status });
    pill.className = "mission-pill" +
      (["planning", "building", "revision", "verifying", "queued"].includes(status) ? " live" : "") +
      (status === "complete" ? " complete" : "") +
      (status === "failed" ? " failed" : "");
  }

  function addFeedRow(ev) {
    const feed = $("feed");
    const hint = feed.querySelector(".feed-hint");
    if (hint) hint.remove();

    const row = document.createElement("div");
    const passFail = ev.type === "check" && ev.data && typeof ev.data.ok === "boolean"
      ? (ev.data.ok ? " check-pass" : " check-fail") : "";
    row.className = "feed-row" + passFail;

    const time = document.createElement("span");
    time.className = "feed-time";
    time.textContent = new Date(ev.ts).toLocaleTimeString([], { hour12: false });

    const agent = document.createElement("span");
    agent.className = "feed-agent " + ev.agent;
    agent.textContent = ev.agent.toUpperCase();

    const msg = document.createElement("span");
    msg.className = "feed-msg";
    msg.textContent = ev.message;

    row.append(time, agent, msg);
    feed.append(row);
    feed.scrollTop = feed.scrollHeight;
    if (feed.children.length > 120) feed.removeChild(feed.firstChild);
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

  function showPreview(missionId) {
    const zone = $("preview-zone");
    zone.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.src = "/p/" + missionId + "/index.html";
    frame.title = "Forged app preview";
    zone.append(frame);

    $("preview-actions").classList.remove("hidden");
    $("preview-link").href = "/p/" + missionId + "/index.html";
    $("download-btn").onclick = () => downloadFiles(missionId);
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
        addFeedRow(payload.event);
      } else if (payload.kind === "token") {
        renderAgents(payload.agent);
        state.activeAgent = payload.agent;
        state.liveBuffer = (state.liveBuffer + payload.token).slice(-4000);
        $("live-stream").textContent = state.liveBuffer;
      } else if (payload.kind === "status") {
        setPill(payload.status);
        if (payload.status === "planning") renderAgents("atlas");
        if (payload.status === "building" || payload.status === "revision") renderAgents("pixel");
        if (payload.status === "verifying") renderAgents("sentinel");
        refreshMissions();
      } else if (payload.kind === "done") {
        es.close();
        state.stream = null;
        renderAgents(null);
        refreshMissions().then(() => {
          if (payload.ok) {
            setPill("complete");
            loadMission(missionId);
            showPreview(missionId);
          } else {
            setPill("failed");
          }
        });
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; if the mission is finished, close it out.
      const m = state.missions.find((x) => x.id === missionId);
      if (m && (m.status === "complete" || m.status === "failed")) es.close();
    };
  }

  async function loadMission(missionId) {
    const res = await fetch("/api/missions/" + missionId);
    if (!res.ok) return;
    const body = await res.json();
    state.activeId = missionId;
    state.done[missionId] = body.mission.status;

    if (body.mission.status !== "complete" && body.mission.status !== "failed") {
      openStream(missionId);
    } else {
      setPill(body.mission.status);
      showPreview(missionId);
    }

    const feed = $("feed");
    feed.innerHTML = "";
    if (!body.events.length) {
      feed.innerHTML = '<div class="feed-hint">This mission has no events.</div>';
    }
    body.events.forEach(addFeedRow);
    renderFiles(body.files || {});
    renderHistory();
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
        (body.models.length ? body.models : []).forEach((m, i) => {
          const opt = document.createElement("option");
          opt.value = m;
          opt.textContent = m;
          if (i === 0) opt.selected = true;
          sel.append(opt);
        });
        if (!body.models.length) {
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
    btn.textContent = "⚒️  FORGING…";

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
      $("feed").innerHTML = "";
      $("code-view").textContent = "";
      $("file-tabs").innerHTML = "";
      $("preview-zone").innerHTML = '<div class="empty">Forging in progress…</div>';
      $("preview-actions").classList.add("hidden");
      await refreshMissions();
      loadMission(body.missionId);
    } catch (err) {
      errBox.textContent = "Request failed: " + err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "⚒️  FORGE APP";
    }
  }

  // ---------------------------------------------------------------- boot

  renderAgents(null);
  refreshOllama();
  refreshMissions().then(() => {
    if (state.missions.length && ["planning", "building", "revision", "verifying", "queued"]
      .includes(state.missions[0].status)) {
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
