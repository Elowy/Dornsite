'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { DATA_DIR } = require('./paths');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'dornsite.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS content (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL DEFAULT '',
    type       TEXT NOT NULL DEFAULT 'image',
    filename   TEXT NOT NULL,
    mime       TEXT NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS votes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    direction  TEXT NOT NULL CHECK (direction IN ('like', 'dislike')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_votes_content ON votes(content_id);
  CREATE INDEX IF NOT EXISTS idx_votes_session ON votes(session_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_unique ON votes(content_id, session_id);
`);

module.exports = db;
