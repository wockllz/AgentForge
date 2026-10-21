/**
 * AgentForge — mock Ollama server for the self-test.
 * Emulates /api/tags and /api/chat (streaming) with deterministic
 * responses, including a FAIL_ONCE mode that first produces broken JS
 * to prove the SENTINEL retry loop actually works.
 */
"use strict";

const http = require("http");

const FAIL_ONCE = process.env.MOCK_FAIL_ONCE === "1";
let buildCalls = 0;

const PLAN = {
  app_name: "pomodoro-forge",
  summary: "A pomodoro timer with a task list.",
  phases: [
    { name: "Structure", tasks: ["Lay out the timer and task list"] },
    { name: "Styling", tasks: ["Style the interface"] },
    { name: "Behaviour", tasks: ["Implement timer logic and task management"] }
  ]
};

function goodApp() {
  return [
    "```html:index.html",
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Pomodoro Forge</title>',
    '<link rel="stylesheet" href="style.css"></head><body>',
    "<h1>Pomodoro Forge</h1>",
    '<div class="timer"><span id="clock">25:00</span><button id="start">Start</button></div>',
    '<ul id="tasks"></ul><form id="add-task"><input id="task-input" placeholder="Add a task"><button type="submit">Add</button></form>',
    '<script src="app.js"></script></body></html>',
    "```",
    "",
    "```css:style.css",
    "body{font-family:system-ui;margin:2rem;background:#111;color:#eee}",
    ".timer{display:flex;gap:1rem;align-items:center}#clock{font-size:3rem}",
    "```",
    "",
    "```javascript:app.js",
    "const clock = document.getElementById('clock');",
    "const start = document.getElementById('start');",
    "let seconds = 1500; let timer = null;",
    "start.addEventListener('click', () => {",
    "  if (timer) { clearInterval(timer); timer = null; start.textContent = 'Start'; return; }",
    "  start.textContent = 'Pause';",
    "  timer = setInterval(() => {",
    "    seconds -= 1;",
    "    clock.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');",
    "  }, 1000);",
    "});",
    "document.getElementById('add-task').addEventListener('submit', (e) => {",
    "  e.preventDefault();",
    "  const input = document.getElementById('task-input');",
    "  const li = document.createElement('li');",
    "  li.textContent = input.value;",
    "  document.getElementById('tasks').appendChild(li);",
    "  input.value = '';",
    "});",
    "```"
  ].join("\n");
}

function brokenApp() {
  // Same app, but app.js has a deliberate syntax error.
  return goodApp().replace(
    "let seconds = 1500; let timer = null;",
    "let seconds = 1500 let timer = null;"
  );
}

function respond(res, obj) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function streamRespond(res, chunks) {
  res.writeHead(200, { "Content-Type": "application/x-ndjson" });
  const all = chunks.join("");
  const tokens = all.match(/[\s\S]{1,24}/g) || [];
  tokens.forEach((token) => {
    res.write(JSON.stringify({ message: { content: token }, done: false }) + "\n");
  });
  res.write(JSON.stringify({ message: { content: "" }, done: true }) + "\n");
  res.end();
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/tags") {
    return respond(res, { models: [{ name: "mock-coder:7b" }] });
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body);
      const userMsg = payload.messages[payload.messages.length - 1].content;

      if (userMsg.startsWith("You are ATLAS")) {
        return streamRespond(res, [JSON.stringify(PLAN)]);
      }
      if (userMsg.startsWith("You are PIXEL")) {
        buildCalls += 1;
        if (FAIL_ONCE && buildCalls === 1) {
          return streamRespond(res, [brokenApp()]);
        }
        return streamRespond(res, [goodApp()]);
      }
      if (userMsg.startsWith("You are SENTINEL")) {
        return respond(res, {
          message: { content: '{"ok":true,"notes":"mock review approved"}' },
          done: true
        });
      }
      return respond(res, { message: { content: "" }, done: true });
    });
    return undefined;
  }

  res.writeHead(404);
  res.end();
});

if (require.main === module) {
  const port = Number(process.env.MOCK_PORT || 11500);
  server.listen(port, () => {
    console.log(`mock-ollama listening on :${port} (fail_once=${FAIL_ONCE})`);
  });
}

module.exports = { server };
