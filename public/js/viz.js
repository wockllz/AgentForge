/**
 * AgentForge — 3D forge visualization.
 * A custom zero-dependency canvas scene: a rotating forge core
 * (projected 3D icosahedron) with the three agents orbiting it on
 * inclined rings. The active agent beams energy into the core.
 */
"use strict";

(function () {
  const canvas = document.getElementById("viz");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d");
  let W = 0;
  let H = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  function hexA(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  const AGENTS = [
    { id: "atlas", label: "ATLAS", color: "#5bb8ff", speed: 0.55, incl: 0.55, phase: 0.0 },
    { id: "pixel", label: "PIXEL", color: "#f0a532", speed: 0.80, incl: -0.95, phase: 2.1 },
    { id: "sentinel", label: "SENTINEL", color: "#58d891", speed: 0.45, incl: 1.65, phase: 4.2 }
  ];

  // --- icosahedron wireframe --------------------------------------------
  const PHI = (1 + Math.sqrt(5)) / 2;
  let V = [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]
  ];
  const E = [];
  for (let i = 0; i < 12; i += 1) {
    for (let j = i + 1; j < 12; j += 1) {
      const a = V[i];
      const b = V[j];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d < 2.1) E.push([i, j]);
    }
  }
  V = V.map((v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  });

  // --- starfield ----------------------------------------------------------
  const stars = [];
  for (let i = 0; i < 70; i += 1) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.1 + 0.3,
      tw: Math.random() * Math.PI * 2
    });
  }

  let t = 0;
  let activeAgent = null;
  let corePulse = 0;
  const particles = [];

  // Public controls for main.js
  window.AgentViz = {
    setActive(agent) {
      activeAgent = agent;
      if (agent) corePulse = 1;
    }
  };

  function project(p, rx, ry) {
    const cy = Math.cos(ry);
    const sy = Math.sin(ry);
    const x1 = p[0] * cy + p[2] * sy;
    const z1 = -p[0] * sy + p[2] * cy;
    const cx = Math.cos(rx);
    const sx = Math.sin(rx);
    const y1 = p[1] * cx - z1 * sx;
    const z2 = p[1] * sx + z1 * cx;
    return { x: x1, y: y1, z: z2 };
  }

  function loop() {
    t += 0.007;
    corePulse = Math.max(corePulse - 0.01, 0);
    const activeColor = (AGENTS.find((a) => a.id === activeAgent) || {}).color || "#f0a532";

    ctx.clearRect(0, 0, W, H);

    // stars
    for (const s of stars) {
      const a = 0.25 + 0.45 * Math.abs(Math.sin(t * 1.5 + s.tw));
      ctx.fillStyle = `rgba(232,226,212,${a})`;
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, 7);
      ctx.fill();
    }

    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.34;
    const ry = t;
    const rx = 0.32 + Math.sin(t * 0.5) * 0.14;

    // ambient core glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (2.0 + corePulse * 0.35));
    glow.addColorStop(0, hexA(activeColor, 0.22 + corePulse * 0.12));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // core wireframe
    for (const pair of E) {
      const a = project(V[pair[0]], rx, ry);
      const b = project(V[pair[1]], rx, ry);
      const depth = (a.z + b.z) / 2;
      ctx.strokeStyle = hexA(activeColor, 0.18 + 0.4 * ((depth + 1) / 2));
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + a.x * R, cy + a.y * R);
      ctx.lineTo(cx + b.x * R, cy + b.y * R);
      ctx.stroke();
    }
    for (const v of V) {
      const p = project(v, rx, ry);
      const size = 1.6 + (p.z + 1);
      ctx.fillStyle = hexA(activeColor, 0.45 + 0.35 * ((p.z + 1) / 2));
      ctx.beginPath();
      ctx.arc(cx + p.x * R, cy + p.y * R, size, 0, 7);
      ctx.fill();
    }

    // agents on inclined orbital rings
    for (const a of AGENTS) {
      const ang = t * a.speed * 2 + a.phase;
      const orbit = R * 1.55;
      const px3 = Math.cos(ang) * orbit;
      const pz3 = Math.sin(ang) * orbit;
      const py3 = Math.sin(ang) * orbit * Math.sin(a.incl) * 0.7;
      const p = project([px3, py3, pz3], rx, ry);
      const x = cx + p.x;
      const y = cy + p.y;
      const isActive = a.id === activeAgent;
      const size = isActive ? 4.6 + Math.sin(t * 7) * 1.1 : 3.0;

      // faint orbit ring
      ctx.strokeStyle = hexA(a.color, isActive ? 0.30 : 0.12);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k <= 64; k += 1) {
        const oa = (k / 64) * Math.PI * 2 + a.phase;
        const op = project([
          Math.cos(oa) * orbit,
          Math.sin(oa) * orbit * Math.sin(a.incl) * 0.7,
          Math.sin(oa) * orbit
        ], rx, ry);
        if (k === 0) ctx.moveTo(cx + op.x, cy + op.y);
        else ctx.lineTo(cx + op.x, cy + op.y);
      }
      ctx.stroke();

      // energy beam while working
      if (isActive) {
        ctx.strokeStyle = hexA(a.color, 0.4);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(cx, cy);
        ctx.stroke();
        if (Math.random() < 0.45) {
          particles.push({ x, y, c: a.color, life: 1 });
        }
      }

      // halo + node
      const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 5);
      halo.addColorStop(0, hexA(a.color, isActive ? 0.85 : 0.4));
      halo.addColorStop(1, hexA(a.color, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, size * 5, 0, 7);
      ctx.fill();
      ctx.fillStyle = a.color;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 7);
      ctx.fill();

      // label
      ctx.font = "700 8px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = hexA(a.color, isActive ? 1 : 0.55);
      ctx.fillText(a.label, x, y - size - 7);
    }

    // energy particles pulled into the core
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.x += (cx - p.x) * 0.055;
      p.y += (cy - p.y) * 0.055;
      p.life -= 0.022;
      if (p.life <= 0 || Math.hypot(cx - p.x, cy - p.y) < 6) {
        particles.splice(i, 1);
        continue;
      }
      ctx.fillStyle = hexA(p.c, Math.max(p.life, 0) * 0.85);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, 7);
      ctx.fill();
    }

    requestAnimationFrame(loop);
  }

  loop();
})();
