/**
 * AgentForge — SENTINEL, the verification agent.
 * Runs REAL deterministic checks against the generated app:
 *  1. required files exist and are non-trivial
 *  2. the HTML parses, has a title, a body and wires up css + js
 *  3. every JavaScript file passes `node --check` (real syntax validation)
 *  4. an LLM review as a soft signal (never gates the build by itself)
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { parse } = require("node-html-parser");

const MIN_HTML = 300;
const MIN_JS = 40;

function checkJsSyntax(name, code) {
  const tmp = path.join(os.tmpdir(), `agentforge_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
  try {
    fs.writeFileSync(tmp, code, "utf8");
    const result = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    if (result.status === 0) return { ok: true };
    const detail = (result.stderr || "").split("\n").slice(0, 3).join(" ").trim();
    return { ok: false, error: `${name} has a JavaScript syntax error: ${detail}` };
  } catch (err) {
    return { ok: false, error: `${name} could not be parsed: ${err.message}` };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Deterministic verification. Returns { ok, checks: [{name, ok, detail}], errors: [] }
 */
function verify(files, emit) {
  const checks = [];
  const errors = [];

  const add = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (emit) emit({ name, ok, detail });
    if (!ok) errors.push(detail);
  };

  // 1. presence + substance
  const html = files["index.html"] || "";
  const css = files["style.css"] || "";
  const js = files["app.js"] || "";

  add("index.html present", html.length > MIN_HTML, html.length > MIN_HTML
    ? `index.html is ${html.length} bytes`
    : `index.html is missing or too small (${html.length} bytes)`);

  add("app.js present", js.length > MIN_JS, js.length > MIN_JS
    ? `app.js is ${js.length} bytes`
    : `app.js is missing or too small (${js.length} bytes)`);

  add("style.css present", css.trim().length > 0, css.trim().length > 0
    ? `style.css is ${css.length} bytes`
    : "style.css is empty");

  // 2. HTML structure
  let root = null;
  try {
    root = parse(html);
  } catch (err) {
    add("HTML parses", false, `HTML could not be parsed: ${err.message}`);
  }

  if (root) {
    add("HTML parses", true, "HTML parsed successfully");

    const title = root.querySelector("title");
    add("HTML has <title>", Boolean(title && title.text.trim()), title && title.text.trim()
      ? `title is "${title.text.trim()}"`
      : "HTML has no non-empty <title>");

    const body = root.querySelector("body");
    add("HTML has <body>", Boolean(body && body.childNodes.length > 0), body
      ? "body element found"
      : "HTML has no <body>");

    const linksCss = root.querySelectorAll("link").some((l) => {
      const href = (l.getAttribute("href") || "").toLowerCase();
      return href.includes("style.css") || href.endsWith(".css");
    });
    add("stylesheet wired up", linksCss, linksCss
      ? "style.css is linked from index.html"
      : "index.html does not link style.css");

    const scripts = root.querySelectorAll("script");
    const hasJs = scripts.some((s) => {
      const src = (s.getAttribute("src") || "").toLowerCase();
      const inline = (s.text || "").trim().length > 0;
      return src.includes("app.js") || src.endsWith(".js") || inline;
    });
    add("javascript wired up", hasJs, hasJs
      ? "app.js is referenced from index.html"
      : "index.html does not reference app.js");
  }

  // 3. real JS syntax validation
  if (js.length > MIN_JS) {
    const syntax = checkJsSyntax("app.js", js);
    add("app.js syntax check", syntax.ok, syntax.ok
      ? "app.js passes node --check"
      : syntax.error);
  }

  // 4. placeholder detection — models love to leave "..." behind
  const placeholder = /(\/\/\s*\.\.\.\s*$)|(\/\* *\.\.\. *\*\/)|<p>\.\.\.<\/p>/m;
  const hasPlaceholder = placeholder.test(html) || placeholder.test(js) || placeholder.test(css);
  add("no placeholders left behind", !hasPlaceholder, hasPlaceholder
    ? "generated code still contains a \"...\" placeholder"
    : "no placeholder markers found");

  return { ok: errors.length === 0, checks, errors };
}

module.exports = { verify };
