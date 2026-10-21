/**
 * AgentForge — database layer (SQLite via better-sqlite3)
 * Stores missions, agent events, and generated file metadata.
 */
"use strict";

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "agentforge.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS missions (
    id          TEXT PRIMARY KEY,
    prompt      TEXT NOT NULL,
    model       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued',
    app_name    TEXT,
    plan        TEXT,
    error       TEXT,
    attempts    INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_id TEXT NOT NULL,
    agent      TEXT NOT NULL,
    type       TEXT NOT NULL,
    message    TEXT NOT NULL,
    data       TEXT,
    ts         TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_mission ON events(mission_id, id);
  CREATE INDEX IF NOT EXISTS idx_missions_created ON missions(created_at DESC);
`);

const now = () => new Date().toISOString();

const stmts = {
  createMission: db.prepare(`
    INSERT INTO missions (id, prompt, model, status, created_at, updated_at)
    VALUES (@id, @prompt, @model, 'queued', @now, @now)
  `),
  getMission: db.prepare(`SELECT * FROM missions WHERE id = ?`),
  listMissions: db.prepare(`
    SELECT id, prompt, model, status, app_name, attempts, duration_ms, created_at
    FROM missions ORDER BY created_at DESC LIMIT 50
  `),
  setMission: db.prepare(`
    UPDATE missions SET
      status = COALESCE(@status, status),
      plan   = COALESCE(@plan,   plan),
      app_name = COALESCE(@app_name, app_name),
      error  = COALESCE(@error,  error),
      attempts = COALESCE(@attempts, attempts),
      duration_ms = COALESCE(@duration_ms, duration_ms),
      updated_at = @now
    WHERE id = @id
  `),
  insertEvent: db.prepare(`
    INSERT INTO events (mission_id, agent, type, message, data, ts)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  listEvents: db.prepare(`
    SELECT * FROM events WHERE mission_id = ? ORDER BY id ASC
  `)
};

function createMission({ id, prompt, model }) {
  stmts.createMission.run({ id, prompt, model, now: now() });
  return stmts.getMission.get(id);
}

function getMission(id) {
  return stmts.getMission.get(id);
}

function listMissions() {
  return stmts.listMissions.all();
}

function updateMission(id, fields = {}) {
  stmts.setMission.run({
    id,
    status: fields.status ?? null,
    plan: fields.plan ?? null,
    app_name: fields.app_name ?? null,
    error: fields.error ?? null,
    attempts: fields.attempts ?? null,
    duration_ms: fields.duration_ms ?? null,
    now: now()
  });
}

function addEvent(missionId, agent, type, message, data) {
  const result = stmts.insertEvent.run(
    missionId,
    agent,
    type,
    message,
    data === undefined ? null : JSON.stringify(data),
    now()
  );
  return {
    id: Number(result.lastInsertRowid),
    mission_id: missionId,
    agent,
    type,
    message,
    data: data ?? null,
    ts: now()
  };
}

function listEvents(missionId) {
  return stmts.listEvents.all(missionId).map((row) => ({
    ...row,
    data: row.data ? JSON.parse(row.data) : null
  }));
}

module.exports = {
  createMission,
  getMission,
  listMissions,
  updateMission,
  addEvent,
  listEvents
};
