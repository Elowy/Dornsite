'use strict';

// MySQL / MariaDB implementáció (mysql2). cPanel-en ez az ajánlott driver.
// Kapcsolat a DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME env változókból.

const mysql = require('mysql2/promise');

let pool;

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
      title      VARCHAR(500) NOT NULL DEFAULT '',
      type       VARCHAR(20)  NOT NULL DEFAULT 'image',
      filename   VARCHAR(255) NOT NULL,
      mime       VARCHAR(100) NOT NULL DEFAULT '',
      active     TINYINT(1)   NOT NULL DEFAULT 1,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
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
}

async function getCards(sessionId, limit) {
  const [rows] = await pool.query(
    `SELECT id, title, type, filename, mime
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
    `SELECT c.id, c.title, c.type, c.filename
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

async function addContent(items) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const it of items) {
      await conn.query(
        `INSERT INTO content (title, type, filename, mime) VALUES (?, ?, ?, ?)`,
        [it.title, it.type, it.filename, it.mime]
      );
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
    `SELECT c.id, c.title, c.type, c.filename, c.mime, c.active, c.created_at,
            COALESCE(SUM(v.direction = 'like'), 0)    AS likes,
            COALESCE(SUM(v.direction = 'dislike'), 0) AS dislikes
       FROM content c
       LEFT JOIN votes v ON v.content_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC`
  );
  return rows.map((r) => ({ ...r, likes: Number(r.likes), dislikes: Number(r.dislikes) }));
}

async function getStats() {
  const [[{ n: totalContent }]] = await pool.query('SELECT COUNT(*) AS n FROM content');
  const [[{ n: activeContent }]] = await pool.query('SELECT COUNT(*) AS n FROM content WHERE active = 1');
  const [[{ n: totalVotes }]] = await pool.query('SELECT COUNT(*) AS n FROM votes');
  const [[{ n: totalLikes }]] = await pool.query("SELECT COUNT(*) AS n FROM votes WHERE direction = 'like'");
  const [[{ n: sessions }]] = await pool.query('SELECT COUNT(DISTINCT session_id) AS n FROM votes');

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
