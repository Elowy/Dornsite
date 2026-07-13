'use strict';

// MySQL / MariaDB implementáció (mysql2). cPanel-en ez az ajánlott driver.
// Kapcsolat a DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME env változókból.

const mysql = require('mysql2/promise');

let pool;

async function columnExists(table, col) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, col]
  );
  return rows.length > 0;
}

async function init() {
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL) || 5,
    charset: 'utf8mb4_general_ci',
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      title      VARCHAR(500)  NOT NULL DEFAULT '',
      link       VARCHAR(1000) NOT NULL DEFAULT '',
      type       VARCHAR(20)   NOT NULL DEFAULT 'image',
      filename   VARCHAR(255)  NOT NULL,
      mime       VARCHAR(100)  NOT NULL DEFAULT '',
      active     TINYINT(1)    NOT NULL DEFAULT 1,
      created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS votes (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      content_id INT NOT NULL,
      session_id VARCHAR(100) NOT NULL,
      direction  ENUM('like','dislike') NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_vote (content_id, session_id),
      KEY idx_content (content_id),
      KEY idx_session (session_id),
      CONSTRAINT fk_votes_content FOREIGN KEY (content_id)
        REFERENCES content(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      email         VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL DEFAULT '',
      display_name  VARCHAR(100) NOT NULL DEFAULT '',
      provider      VARCHAR(20)  NOT NULL DEFAULT 'local',
      provider_id   VARCHAR(255) NOT NULL DEFAULT '',
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      content_id INT NOT NULL,
      user_id    INT NOT NULL,
      body       TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_comments_content (content_id),
      CONSTRAINT fk_comments_content FOREIGN KEY (content_id)
        REFERENCES content(id) ON DELETE CASCADE,
      CONSTRAINT fk_comments_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tags (
      id   INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_tags (
      content_id INT NOT NULL,
      tag_id     INT NOT NULL,
      PRIMARY KEY (content_id, tag_id),
      KEY idx_content_tags_tag (tag_id),
      CONSTRAINT fk_ct_content FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE,
      CONSTRAINT fk_ct_tag     FOREIGN KEY (tag_id)     REFERENCES tags(id)    ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      user_id    INT NOT NULL,
      type       VARCHAR(20)  NOT NULL DEFAULT 'comment',
      content_id INT NULL,
      actor_name VARCHAR(100) NOT NULL DEFAULT '',
      body       VARCHAR(500) NOT NULL DEFAULT '',
      is_read    TINYINT(1)   NOT NULL DEFAULT 0,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_notif_user (user_id),
      CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_notif_content FOREIGN KEY (content_id) REFERENCES content(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Migráció: régi adatbázisokban hiányozhat a link oszlop.
  if (!(await columnExists('content', 'link'))) {
    await pool.query(
      `ALTER TABLE content ADD COLUMN link VARCHAR(1000) NOT NULL DEFAULT '' AFTER title`
    );
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

// db lehet a pool vagy egy tranzakciós connection
async function setTagsRaw(db, contentId, tagNames) {
  const names = normalizeTags(tagNames);
  await db.query('DELETE FROM content_tags WHERE content_id = ?', [contentId]);
  for (const name of names) {
    await db.query('INSERT IGNORE INTO tags (name) VALUES (?)', [name]);
    const [[tag]] = await db.query('SELECT id FROM tags WHERE name = ?', [name]);
    await db.query('INSERT IGNORE INTO content_tags (content_id, tag_id) VALUES (?, ?)', [
      contentId,
      tag.id,
    ]);
  }
}

async function tagsFor(contentId) {
  const [rows] = await pool.query(
    `SELECT t.name FROM content_tags ct JOIN tags t ON t.id = ct.tag_id
      WHERE ct.content_id = ? ORDER BY t.name`,
    [contentId]
  );
  return rows.map((r) => r.name);
}

async function listTags() {
  const [rows] = await pool.query(
    `SELECT t.name, COUNT(c.id) AS count
       FROM tags t
       LEFT JOIN content_tags ct ON ct.tag_id = t.id
       LEFT JOIN content c ON c.id = ct.content_id AND c.active = 1
      GROUP BY t.id
      HAVING count > 0
      ORDER BY count DESC, t.name`
  );
  return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
}

// --- Tartalom (publikus) ---
async function getCards(sessionId, limit, tag) {
  if (tag) {
    const [rows] = await pool.query(
      `SELECT c.id, c.title, c.link, c.type, c.filename, c.mime
         FROM content c
         JOIN content_tags ct ON ct.content_id = c.id
         JOIN tags t ON t.id = ct.tag_id
        WHERE c.active = 1 AND t.name = ?
          AND c.id NOT IN (SELECT content_id FROM votes WHERE session_id = ?)
        ORDER BY RAND() LIMIT ?`,
      [String(tag).toLowerCase(), sessionId, Number(limit)]
    );
    return rows;
  }
  const [rows] = await pool.query(
    `SELECT id, title, link, type, filename, mime
       FROM content
      WHERE active = 1
        AND id NOT IN (SELECT content_id FROM votes WHERE session_id = ?)
      ORDER BY RAND()
      LIMIT ?`,
    [sessionId, Number(limit)]
  );
  return rows;
}

async function contentActiveExists(id) {
  const [rows] = await pool.query('SELECT id FROM content WHERE id = ? AND active = 1', [id]);
  return rows.length > 0;
}

async function getPublicContent(id) {
  const [rows] = await pool.query(
    'SELECT id, title, link, type, filename FROM content WHERE id = ? AND active = 1',
    [id]
  );
  if (!rows[0]) return null;
  rows[0].tags = await tagsFor(id);
  return rows[0];
}

async function vote(contentId, sessionId, direction) {
  await pool.query(
    `INSERT INTO votes (content_id, session_id, direction)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE direction = VALUES(direction), created_at = CURRENT_TIMESTAMP`,
    [contentId, sessionId, direction]
  );
}

async function getLikesAndStats(sessionId) {
  const [liked] = await pool.query(
    `SELECT c.id, c.title, c.type, c.filename, c.link
       FROM votes v JOIN content c ON c.id = v.content_id
      WHERE v.session_id = ? AND v.direction = 'like'
      ORDER BY v.created_at DESC`,
    [sessionId]
  );

  const [counts] = await pool.query(
    `SELECT direction, COUNT(*) AS n FROM votes WHERE session_id = ? GROUP BY direction`,
    [sessionId]
  );

  const stats = { like: 0, dislike: 0 };
  for (const c of counts) stats[c.direction] = Number(c.n);
  return { liked, stats };
}

// --- Tartalom (admin) ---
async function addContent(items) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const it of items) {
      const [res] = await conn.query(
        `INSERT INTO content (title, link, type, filename, mime) VALUES (?, ?, ?, ?, ?)`,
        [it.title, it.link || '', it.type, it.filename, it.mime]
      );
      await setTagsRaw(conn, res.insertId, it.tags);
    }
    await conn.commit();
    return items.length;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listContent() {
  const [rows] = await pool.query(
    `SELECT c.id, c.title, c.link, c.type, c.filename, c.mime, c.active, c.created_at,
            COALESCE(SUM(v.direction = 'like'), 0)    AS likes,
            COALESCE(SUM(v.direction = 'dislike'), 0) AS dislikes,
            (SELECT COUNT(*) FROM comments cm WHERE cm.content_id = c.id) AS comments
       FROM content c
       LEFT JOIN votes v ON v.content_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC`
  );

  const [tagRows] = await pool.query(
    `SELECT ct.content_id AS cid, t.name FROM content_tags ct JOIN tags t ON t.id = ct.tag_id`
  );
  const tagMap = {};
  for (const tr of tagRows) (tagMap[tr.cid] = tagMap[tr.cid] || []).push(tr.name);

  return rows.map((r) => ({
    ...r,
    likes: Number(r.likes),
    dislikes: Number(r.dislikes),
    comments: Number(r.comments),
    tags: (tagMap[r.id] || []).sort(),
  }));
}

async function editContent(id, { title, link, tags }) {
  const [res] = await pool.query('UPDATE content SET title = ?, link = ? WHERE id = ?', [
    title,
    link || '',
    id,
  ]);
  if (res.affectedRows === 0) return false;
  if (tags !== undefined) await setTagsRaw(pool, id, tags);
  return true;
}

async function getStats() {
  const [[{ n: totalContent }]] = await pool.query('SELECT COUNT(*) AS n FROM content');
  const [[{ n: activeContent }]] = await pool.query('SELECT COUNT(*) AS n FROM content WHERE active = 1');
  const [[{ n: totalVotes }]] = await pool.query('SELECT COUNT(*) AS n FROM votes');
  const [[{ n: totalLikes }]] = await pool.query("SELECT COUNT(*) AS n FROM votes WHERE direction = 'like'");
  const [[{ n: sessions }]] = await pool.query('SELECT COUNT(DISTINCT session_id) AS n FROM votes');
  const [[{ n: totalUsers }]] = await pool.query('SELECT COUNT(*) AS n FROM users');
  const [[{ n: totalComments }]] = await pool.query('SELECT COUNT(*) AS n FROM comments');

  const [topLiked] = await pool.query(
    `SELECT c.id, c.title, c.filename, c.type, COUNT(*) AS likes
       FROM votes v JOIN content c ON c.id = v.content_id
      WHERE v.direction = 'like'
      GROUP BY c.id ORDER BY likes DESC LIMIT 5`
  );

  return {
    totalContent: Number(totalContent),
    activeContent: Number(activeContent),
    totalVotes: Number(totalVotes),
    totalLikes: Number(totalLikes),
    totalDislikes: Number(totalVotes) - Number(totalLikes),
    sessions: Number(sessions),
    totalUsers: Number(totalUsers),
    totalComments: Number(totalComments),
    topLiked: topLiked.map((r) => ({ ...r, likes: Number(r.likes) })),
  };
}

async function setActive(id, active) {
  const [res] = await pool.query('UPDATE content SET active = ? WHERE id = ?', [active ? 1 : 0, id]);
  return res.affectedRows > 0;
}

async function deleteContent(id) {
  const [rows] = await pool.query('SELECT filename FROM content WHERE id = ?', [id]);
  if (rows.length === 0) return null;
  await pool.query('DELETE FROM content WHERE id = ?', [id]);
  return rows[0].filename;
}

// --- Felhasználók ---
async function createUser({ email, passwordHash, displayName, provider = 'local', providerId = '' }) {
  const [res] = await pool.query(
    `INSERT INTO users (email, password_hash, display_name, provider, provider_id)
     VALUES (?, ?, ?, ?, ?)`,
    [email, passwordHash, displayName, provider, providerId]
  );
  return { id: res.insertId, email, displayName };
}

async function getUserByEmail(email) {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0] || null;
}

async function getUserById(id) {
  const [rows] = await pool.query(
    'SELECT id, email, display_name, provider FROM users WHERE id = ?',
    [id]
  );
  return rows[0] || null;
}

async function getUserByProvider(provider, providerId) {
  const [rows] = await pool.query('SELECT * FROM users WHERE provider = ? AND provider_id = ?', [
    provider,
    providerId,
  ]);
  return rows[0] || null;
}

// --- Kommentek ---
async function addComment(contentId, userId, body) {
  const [res] = await pool.query(
    `INSERT INTO comments (content_id, user_id, body) VALUES (?, ?, ?)`,
    [contentId, userId, body]
  );
  const [rows] = await pool.query(
    `SELECT cm.id, cm.body, cm.created_at, cm.user_id, u.display_name
       FROM comments cm JOIN users u ON u.id = cm.user_id
      WHERE cm.id = ?`,
    [res.insertId]
  );
  return rows[0];
}

async function getComments(contentId) {
  const [rows] = await pool.query(
    `SELECT cm.id, cm.body, cm.created_at, cm.user_id, u.display_name
       FROM comments cm JOIN users u ON u.id = cm.user_id
      WHERE cm.content_id = ?
      ORDER BY cm.created_at ASC`,
    [contentId]
  );
  return rows;
}

async function deleteComment(id, userId, isAdmin) {
  const [rows] = await pool.query('SELECT user_id FROM comments WHERE id = ?', [id]);
  if (rows.length === 0) return false;
  if (!isAdmin && rows[0].user_id !== userId) return false;
  await pool.query('DELETE FROM comments WHERE id = ?', [id]);
  return true;
}

// --- "Match" jelzés: egy tartalom hány like-ot kapott ---
async function getLikeCount(contentId) {
  const [[{ n }]] = await pool.query(
    "SELECT COUNT(*) AS n FROM votes WHERE content_id = ? AND direction = 'like'",
    [contentId]
  );
  return Number(n);
}

// --- Értesítések ---
async function addCommentNotifications(contentId, actorUserId, actorName) {
  const [[row]] = await pool.query('SELECT title FROM content WHERE id = ?', [contentId]);
  const title = (row && row.title) || '';
  await pool.query(
    `INSERT INTO notifications (user_id, type, content_id, actor_name, body)
     SELECT DISTINCT c.user_id, 'comment', ?, ?, ?
       FROM comments c
      WHERE c.content_id = ? AND c.user_id <> ?`,
    [contentId, actorName, title, contentId, actorUserId]
  );
}

async function listNotifications(userId, limit = 30) {
  const [rows] = await pool.query(
    `SELECT id, type, content_id, actor_name, body, is_read, created_at
       FROM notifications WHERE user_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    [userId, Number(limit)]
  );
  const items = rows.map((r) => ({ ...r, is_read: !!r.is_read }));
  const [[{ n: unread }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  return { items, unread: Number(unread) };
}

async function markNotificationsRead(userId) {
  await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [userId]);
}

module.exports = {
  init,
  getCards,
  listTags,
  contentActiveExists,
  getPublicContent,
  vote,
  getLikeCount,
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
  addCommentNotifications,
  listNotifications,
  markNotificationsRead,
};
