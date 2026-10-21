/**
 * AgentForge — prompt library for the three agents.
 * The agents reason in structured layers: ATLAS thinks about the product
 * AND sets an explicit design direction; PIXEL executes that direction.
 * Prompts stay short and directive — small local models follow them best.
 */
"use strict";

function planPrompt(userIdea) {
  return `You are ATLAS, the planning agent of a software team. Think through the user's idea, then produce a compact build plan.

Reply with ONLY valid JSON, no other text, in exactly this shape:
{"thinking":"one sentence of product reasoning","app_name":"short-kebab-case-name","summary":"one sentence describing the app","design_notes":{"vibe":"2-4 words","colors":"short color palette description","layout":"short layout description"},"phases":[{"name":"phase name","tasks":["task 1","task 2"]}]}

Rules: 2-4 phases, 1-3 tasks per phase. The app is a single-page web app in plain HTML, CSS and vanilla JavaScript only. design_notes will be handed to the builder agent — make them concrete (e.g. colors:"dark charcoal + amber accents").

USER IDEA: ${userIdea}`;
}

function buildPrompt(userIdea, plan, attempt, errors) {
  const design = plan.design_notes
    ? `DESIGN DIRECTION (from ATLAS — follow it):
- vibe: ${plan.design_notes.vibe || "clean and modern"}
- colors: ${plan.design_notes.colors || "dark background with strong accent color"}
- layout: ${plan.design_notes.layout || "centered, single column"}`
    : "DESIGN DIRECTION: clean, modern, responsive.";

  const errorBlock = attempt > 1 && errors && errors.length
    ? `\nThe previous attempt failed verification. FIX these problems:\n${errors.map((e) => `- ${e}`).join("\n")}\n`
    : "";

  return `You are PIXEL, the builder agent of a software team. Build a COMPLETE, working single-page web app for this idea:

${userIdea}

BUILD PLAN:
${JSON.stringify({ app_name: plan.app_name, summary: plan.summary, phases: plan.phases })}

${design}
${errorBlock}
Output EXACTLY three fenced code blocks, in this order, each opened by its marker line, with no other prose:

\`\`\`html:index.html
<!DOCTYPE html> ... the full app ...
\`\`\`

\`\`\`css:style.css
/* full stylesheet */
\`\`\`

\`\`\`javascript:app.js
// full JavaScript
\`\`\`

Hard requirements:
- index.html must link style.css and app.js (<link rel="stylesheet" href="style.css"> and <script src="app.js"></script> before </body>)
- The app must be genuinely interactive and functional (real event handlers, working state)
- Apply the design direction: this should look designed, not default
- Plain vanilla JavaScript only — no frameworks, no imports, no CDN
- Include a <title> and a visible header with the app name
- Write ALL the code. Never put "..." or placeholders.`;
}

function reviewPrompt(userIdea, fileSummary) {
  return `You are SENTINEL, the verification agent of a software team. A builder agent claims this app is finished.

USER REQUEST: ${userIdea}

FILES PRODUCED (summaries):
${fileSummary}

Reply with ONLY valid JSON: {"ok":true|false,"notes":"one sentence"}`;
}

module.exports = { planPrompt, buildPrompt, reviewPrompt };
