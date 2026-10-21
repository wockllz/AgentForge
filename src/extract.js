/**
 * AgentForge — output extraction helpers.
 * Local models wrap code and JSON in unpredictable ways; these parsers
 * recover the payloads without ever throwing.
 */
"use strict";

/**
 * Extract fenced code blocks with optional "lang:filename" headers.
 * Returns [{ lang, filename, content }]
 */
function extractCodeBlocks(text) {
  const blocks = [];
  const re = /```([A-Za-z0-9+#-]*)(?::([^\n`]+))?\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const lang = (match[1] || "").toLowerCase();
    const filename = (match[2] || "").trim();
    const content = match[3];
    if (content && content.trim()) {
      blocks.push({ lang, filename, content });
    }
  }
  return blocks;
}

/**
 * Map raw blocks to a canonical { html, css, js } file set.
 * Tolerates missing headers, missing files, and mislabelled blocks.
 */
function toFileSet(blocks) {
  const files = {};

  for (const block of blocks) {
    const fname = block.filename.toLowerCase();
    const lang = block.lang;

    if (fname.endsWith(".html") || lang === "html") {
      files["index.html"] = block.content;
    } else if (fname.endsWith(".css") || lang === "css") {
      files["style.css"] = block.content;
    } else if (fname.endsWith(".js") || lang === "javascript" || lang === "js") {
      files["app.js"] = block.content;
    }
  }

  // Fallbacks: if the model emitted fewer than three files, keep the app alive.
  if (!files["style.css"]) {
    files["style.css"] =
      "/* PIXEL emitted no stylesheet */\n" +
      "body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#f5f6f8;color:#111}\n";
  }
  if (!files["app.js"]) {
    files["app.js"] = "// PIXEL emitted no JavaScript\n";
  }

  return files;
}

/**
 * Extract the first balanced JSON object from arbitrary text.
 * Returns the parsed object or null.
 */
function extractJson(text) {
  // 1) direct parse (model behaved)
  try {
    return JSON.parse(text);
  } catch {
    /* keep digging */
  }

  // 2) inside a fenced block
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* keep digging */
    }
  }

  // 3) first {...} with balanced braces
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * A sane fallback plan when the planner's JSON is unusable.
 */
function defaultPlan(idea) {
  return {
    app_name: "forged-app",
    summary: idea.slice(0, 140),
    phases: [
      { name: "Structure", tasks: ["Lay out the interface in HTML"] },
      { name: "Styling", tasks: ["Style the interface in CSS"] },
      { name: "Behaviour", tasks: ["Implement interactivity in JavaScript"] }
    ]
  };
}

module.exports = { extractCodeBlocks, toFileSet, extractJson, defaultPlan };
