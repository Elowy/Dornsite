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

    CREATE TABLE IF NOT EXISTS tags (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS content_tags (
      content_id INTEGER NOT NULL,
      tag_id     INTEGER NOT NULL,
      PRIMARY KEY (content_id, tag_id),
      FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id)     REFERENCES tags(id)    ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_votes_content ON votes(content_id);
    CREATE INDEX IF NOT EXISTS idx_votes_session ON votes(session_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_unique ON votes(content_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_comments_content ON comments(content_id);
    CREATE INDEX IF NOT EXISTS idx_content_tags_tag ON content_tags(tag_id);
  `);

  // Migráció: régi adatbázisokban hiányozhat a link oszlop.
  const hasLink = db.prepare(`PRAGMA table_info(content)`).all().some((c) => c.name === 'link');
  if (!hasLink) {
    db.exec(`ALTER TABLE content ADD COLUMN link TEXT NOT NULL DEFAULT ''`);
  }
}

// --- Címkék (tag-ek) segédfüggvényei ---
function normalizeTags(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const name = String(raw).trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.slice(0, 20);
}

// Tranzakció nélkül (hívható egy külső tranzakción belül is)
function setTagsRaw(contentId, tagNames) {
  const names = normalizeTags(tagNames);
  db.prepare('DELETE FROM content_tags WHERE content_id = ?').run(contentId);
  const insTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
  const getTag = db.prepare('SELECT id FROM tags WHERE name = ?');
  const link = db.prepare('INSERT OR IGNORE INTO content_tags (content_id, tag_id) VALUES (?, ?)');
  for (const name of names) {
    insTag.run(name);
    link.run(contentId, getTag.get(name).id);
  }
}

function tagsFor(contentId) {
  return db
    .prepare(
      `SELECT t.name FROM content_tags ct JOIN tags t ON t.id = ct.tag_id
        WHERE ct.content_id = ? ORDER BY t.name`
    )
    .all(contentId)
    .map((r) => r.name);
}

async function listTags() {
  return db
    .prepare(
      `SELECT t.name, COUNT(c.id) AS count
         FROM tags t
         LEFT JOIN content_tags ct ON ct.tag_id = t.id
         LEFT JOIN content c ON c.id = ct.content_id AND c.active = 1
        GROUP BY t.id
        HAVING count > 0
        ORDER BY count DESC, t.name`
    )
    .all()
    .map((r) => ({ name: r.name, count: Number(r.count) }));
}

// --- Tartalom (publikus) ---
async function getCards(sessionId, limit, tag) {
  const rows = tag
    ? db
        .prepare(
          `SELECT c.id, c.title, c.link, c.type, c.filename, c.mime
             FROM content c
             JOIN content_tags ct ON ct.content_id = c.id
             JOIN tags t ON t.id = ct.tag_id
            WHERE c.active = 1 AND t.name = ?
              AND c.id NOT IN (SELECT content_id FROM votes WHERE session_id = ?)
            ORDER BY RANDOM() LIMIT ?`
        )
        .all(String(tag).toLowerCase(), sessionId, limit)
    : db
        .prepare(
          `SELECT id, title, link, type, filename, mime
             FROM content
            WHERE active = 1
              AND id NOT IN (SELECT content_id FROM votes WHERE session_id = ?)
            ORDER BY RANDOM()
            LIMIT ?`
        )
        .all(sessionId, limit);
  return rows;
}

async function contentActiveExists(id) {
  return !!db.prepare('SELECT id FROM content WHERE id = ? AND active = 1').get(id);
}

async function getPublicContent(id) {
  const row = db
    .prepare(`SELECT id, title, link, type, filename FROM content WHERE id = ? AND active = 1`)
    .get(id);
  if (!row) return null;
  row.tags = tagsFor(id);
  return row;
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
    for (const it of list) {
      const info = insert.run(it.title, it.link || '', it.type, it.filename, it.mime);
      setTagsRaw(info.lastInsertRowid, it.tags);
    }
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
      tags: tagsFor(r.id),
    }));
}

async function editContent(id, { title, link, tags }) {
  const info = db
    .prepare('UPDATE content SET title = ?, link = ? WHERE id = ?')
    .run(title, link || '', id);
  if (info.changes === 0) return false;
  if (tags !== undefined) setTagsRaw(id, tags);
  return true;
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
  listTags,
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
