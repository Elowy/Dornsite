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
      link       TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      display_name  TEXT NOT NULL DEFAULT '',
      provider      TEXT NOT NULL DEFAULT 'local',
      provider_id   TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)   ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_votes_content ON votes(content_id);
    CREATE INDEX IF NOT EXISTS idx_votes_session ON votes(session_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_unique ON votes(content_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_comments_content ON comments(content_id);
  `);

  // Migráció: régi adatbázisokban hiányozhat a link oszlop.
  const hasLink = db.prepare(`PRAGMA table_info(content)`).all().some((c) => c.name === 'link');
  if (!hasLink) {
    db.exec(`ALTER TABLE content ADD COLUMN link TEXT NOT NULL DEFAULT ''`);
  }
}

// --- Tartalom (publikus) ---
async function getCards(sessionId, limit) {
  return db
    .prepare(
      `SELECT id, title, link, type, filename, mime
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

async function getPublicContent(id) {
  return (
    db
      .prepare(`SELECT id, title, link, type, filename FROM content WHERE id = ? AND active = 1`)
      .get(id) || null
  );
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
      `SELECT c.id, c.title, c.type, c.filename, c.link
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

// --- Tartalom (admin) ---
async function addContent(items) {
  const insert = db.prepare(
    `INSERT INTO content (title, link, type, filename, mime) VALUES (?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((list) => {
    for (const it of list) insert.run(it.title, it.link || '', it.type, it.filename, it.mime);
  });
  tx(items);
  return items.length;
}

async function listContent() {
  return db
    .prepare(
      `SELECT c.id, c.title, c.link, c.type, c.filename, c.mime, c.active, c.created_at,
              COALESCE(SUM(v.direction = 'like'), 0)    AS likes,
              COALESCE(SUM(v.direction = 'dislike'), 0) AS dislikes,
              (SELECT COUNT(*) FROM comments cm WHERE cm.content_id = c.id) AS comments
         FROM content c
         LEFT JOIN votes v ON v.content_id = c.id
        GROUP BY c.id
        ORDER BY c.created_at DESC`
    )
    .all()
    .map((r) => ({
      ...r,
      likes: Number(r.likes),
      dislikes: Number(r.dislikes),
      comments: Number(r.comments),
    }));
}

async function editContent(id, { title, link }) {
  const info = db
    .prepare('UPDATE content SET title = ?, link = ? WHERE id = ?')
    .run(title, link || '', id);
  return info.changes > 0;
}

async function getStats() {
  const totalContent = db.prepare('SELECT COUNT(*) AS n FROM content').get().n;
  const activeContent = db.prepare('SELECT COUNT(*) AS n FROM content WHERE active = 1').get().n;
  const totalVotes = db.prepare('SELECT COUNT(*) AS n FROM votes').get().n;
  const totalLikes = db.prepare("SELECT COUNT(*) AS n FROM votes WHERE direction = 'like'").get().n;
  const sessions = db.prepare('SELECT COUNT(DISTINCT session_id) AS n FROM votes').get().n;
  const totalUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const totalComments = db.prepare('SELECT COUNT(*) AS n FROM comments').get().n;

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
    totalUsers,
    totalComments,
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

// --- Felhasználók ---
async function createUser({ email, passwordHash, displayName, provider = 'local', providerId = '' }) {
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, display_name, provider, provider_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(email, passwordHash, displayName, provider, providerId);
  return { id: info.lastInsertRowid, email, displayName };
}

async function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null;
}

async function getUserById(id) {
  return (
    db.prepare('SELECT id, email, display_name, provider FROM users WHERE id = ?').get(id) || null
  );
}

async function getUserByProvider(provider, providerId) {
  return (
    db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?').get(provider, providerId) ||
    null
  );
}

// --- Kommentek ---
async function addComment(contentId, userId, body) {
  const info = db
    .prepare(`INSERT INTO comments (content_id, user_id, body) VALUES (?, ?, ?)`)
    .run(contentId, userId, body);
  return db
    .prepare(
      `SELECT cm.id, cm.body, cm.created_at, cm.user_id, u.display_name
         FROM comments cm JOIN users u ON u.id = cm.user_id
        WHERE cm.id = ?`
    )
    .get(info.lastInsertRowid);
}

async function getComments(contentId) {
  return db
    .prepare(
      `SELECT cm.id, cm.body, cm.created_at, cm.user_id, u.display_name
         FROM comments cm JOIN users u ON u.id = cm.user_id
        WHERE cm.content_id = ?
        ORDER BY cm.created_at ASC`
    )
    .all(contentId);
}

async function deleteComment(id, userId, isAdmin) {
  const row = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(id);
  if (!row) return false;
  if (!isAdmin && row.user_id !== userId) return false;
  db.prepare('DELETE FROM comments WHERE id = ?').run(id);
  return true;
}

module.exports = {
  init,
  getCards,
  contentActiveExists,
  getPublicContent,
  vote,
  getLikesAndStats,
  addContent,
  listContent,
  editContent,
  getStats,
  setActive,
  deleteContent,
  createUser,
  getUserByEmail,
  getUserById,
  getUserByProvider,
  addComment,
  getComments,
  deleteComment,
};
