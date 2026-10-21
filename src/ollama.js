/**
 * AgentForge — Ollama client.
 * Talks to a local Ollama server (default http://127.0.0.1:11434).
 * Supports plain chat calls and token streaming.
 */
"use strict";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 240000; // 4 min — local models can be slow

async function listModels() {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, {
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`);
  const body = await res.json();
  return (body.models || []).map((m) => m.name);
}

/**
 * Non-streaming chat call. Returns the assistant message string.
 */
async function chat(model, messages, options = {}) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.4,
        num_ctx: options.num_ctx ?? 8192
      }
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama chat failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const body = await res.json();
  return (body.message && body.message.content) || "";
}

/**
 * Streaming chat call. Calls onToken(token) for each generated token chunk.
 * Returns the full assistant message string.
 */
async function chatStream(model, messages, onToken, options = {}) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: {
        temperature: options.temperature ?? 0.4,
        num_ctx: options.num_ctx ?? 8192
      }
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama chat failed (${res.status}): ${text.slice(0, 300)}`);
  }

  let full = "";
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch {
        continue; // tolerate malformed keepalive lines
      }
      const token = payload.message && payload.message.content;
      if (token) {
        full += token;
        if (onToken) onToken(token);
      }
    }
  }

  return full;
}

module.exports = { OLLAMA_URL, listModels, chat, chatStream };
