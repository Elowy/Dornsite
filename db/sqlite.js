'use strict';

// SQLite implementáció (better-sqlite3). A modul csak akkor töltődik be, ha a
// DB_DRIVER sqlite – így a natív better-sqlite3 opcionális maradhat.

const path = require('path');
const fs = require('fs');
const { DATA_DIR } = require('../paths');

let db;

async function init() {
  const Database = require('better-sqlite3'); // lazy: csak sqlite driver esetén
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(path.join(DATA_DIR, 'dornsite.db'));
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
}

async function getCards(sessionId, limit) {
  return db
    .prepare(
      `SELECT id, title, type, filename, mime
         FROM content
        WHERE active = 1
          AND id NOT IN (SELECT content_id FROM votes WHERE session_id = ?)
        ORDER BY RANDOM()
        LIMIT ?`
    )
    .all(sessionId, limit);
}

async function contentActiveExists(id) {
  return !!db.prepare('SELECT id FROM content WHERE id = ? AND active = 1').get(id);
}

async function vote(contentId, sessionId, direction) {
  db.prepare(
    `INSERT INTO votes (content_id, session_id, direction)
     VALUES (?, ?, ?)
     ON CONFLICT(content_id, session_id)
     DO UPDATE SET direction = excluded.direction, created_at = datetime('now')`
  ).run(contentId, sessionId, direction);
}

async function getLikesAndStats(sessionId) {
  const liked = db
    .prepare(
      `SELECT c.id, c.title, c.type, c.filename
         FROM votes v JOIN content c ON c.id = v.content_id
        WHERE v.session_id = ? AND v.direction = 'like'
        ORDER BY v.created_at DESC`
    )
    .all(sessionId);

  const counts = db
    .prepare(`SELECT direction, COUNT(*) AS n FROM votes WHERE session_id = ? GROUP BY direction`)
    .all(sessionId);

  const stats = { like: 0, dislike: 0 };
  for (const c of counts) stats[c.direction] = Number(c.n);
  return { liked, stats };
}

async function addContent(items) {
  const insert = db.prepare(`INSERT INTO content (title, type, filename, mime) VALUES (?, ?, ?, ?)`);
  const tx = db.transaction((list) => {
    for (const it of list) insert.run(it.title, it.type, it.filename, it.mime);
  });
  tx(items);
  return items.length;
}

async function listContent() {
  return db
    .prepare(
      `SELECT c.id, c.title, c.type, c.filename, c.mime, c.active, c.created_at,
              COALESCE(SUM(v.direction = 'like'), 0)    AS likes,
              COALESCE(SUM(v.direction = 'dislike'), 0) AS dislikes
         FROM content c
         LEFT JOIN votes v ON v.content_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC`
    )
    .all()
    .map((r) => ({ ...r, likes: Number(r.likes), dislikes: Number(r.dislikes) }));
}

async function getStats() {
  const totalContent = db.prepare('SELECT COUNT(*) AS n FROM content').get().n;
  const activeContent = db.prepare('SELECT COUNT(*) AS n FROM content WHERE active = 1').get().n;
  const totalVotes = db.prepare('SELECT COUNT(*) AS n FROM votes').get().n;
  const totalLikes = db.prepare("SELECT COUNT(*) AS n FROM votes WHERE direction = 'like'").get().n;
  const sessions = db.prepare('SELECT COUNT(DISTINCT session_id) AS n FROM votes').get().n;

  const topLiked = db
    .prepare(
      `SELECT c.id, c.title, c.filename, c.type, COUNT(*) AS likes
         FROM votes v JOIN content c ON c.id = v.content_id
        WHERE v.direction = 'like'
        GROUP BY c.id ORDER BY likes DESC LIMIT 5`
    )
    .all()
    .map((r) => ({ ...r, likes: Number(r.likes) }));

  return {
    totalContent,
    activeContent,
    totalVotes,
    totalLikes,
    totalDislikes: totalVotes - totalLikes,
    sessions,
    topLiked,
  };
}

async function setActive(id, active) {
  const info = db.prepare('UPDATE content SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  return info.changes > 0;
}

async function deleteContent(id) {
  const row = db.prepare('SELECT filename FROM content WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('DELETE FROM content WHERE id = ?').run(id);
  return row.filename;
}

module.exports = {
  init,
  getCards,
  contentActiveExists,
  vote,
  getLikesAndStats,
  addContent,
  listContent,
  getStats,
  setActive,
  deleteContent,
};
