'use strict';

const express = require('express');
const db = require('../db');

const router = express.Router();

// Véletlenszerű kártyák lekérése, amikre az adott session még nem szavazott
router.get('/cards', (req, res) => {
  const sessionId = String(req.query.session || '').trim();
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 30);

  if (!sessionId) {
    return res.status(400).json({ error: 'Hiányzó session azonosító' });
  }

  const rows = db
    .prepare(
      `SELECT id, title, type, filename, mime
         FROM content
        WHERE active = 1
          AND id NOT IN (
            SELECT content_id FROM votes WHERE session_id = ?
          )
        ORDER BY RANDOM()
        LIMIT ?`
    )
    .all(sessionId, limit);

  const cards = rows.map((r) => ({
    id: r.id,
    title: r.title,
    type: r.type,
    url: `/uploads/${r.filename}`,
  }));

  res.json({ cards });
});

// Szavazat leadása (like = jobbra, dislike = balra)
router.post('/vote', (req, res) => {
  const { contentId, direction, session } = req.body || {};
  const sessionId = String(session || '').trim();

  if (!sessionId) {
    return res.status(400).json({ error: 'Hiányzó session azonosító' });
  }
  if (!['like', 'dislike'].includes(direction)) {
    return res.status(400).json({ error: 'Érvénytelen irány' });
  }

  const content = db
    .prepare('SELECT id FROM content WHERE id = ? AND active = 1')
    .get(contentId);
  if (!content) {
    return res.status(404).json({ error: 'A tartalom nem található' });
  }

  db.prepare(
    `INSERT INTO votes (content_id, session_id, direction)
     VALUES (?, ?, ?)
     ON CONFLICT(content_id, session_id)
     DO UPDATE SET direction = excluded.direction, created_at = datetime('now')`
  ).run(contentId, sessionId, direction);

  res.json({ ok: true });
});

// Az adott session statisztikái + kedvelt tartalmak ("matchek")
router.get('/likes', (req, res) => {
  const sessionId = String(req.query.session || '').trim();
  if (!sessionId) {
    return res.status(400).json({ error: 'Hiányzó session azonosító' });
  }

  const liked = db
    .prepare(
      `SELECT c.id, c.title, c.type, c.filename
         FROM votes v
         JOIN content c ON c.id = v.content_id
        WHERE v.session_id = ? AND v.direction = 'like'
        ORDER BY v.created_at DESC`
    )
    .all(sessionId)
    .map((r) => ({ id: r.id, title: r.title, type: r.type, url: `/uploads/${r.filename}` }));

  const counts = db
    .prepare(
      `SELECT direction, COUNT(*) AS n
         FROM votes WHERE session_id = ? GROUP BY direction`
    )
    .all(sessionId);

  const stats = { like: 0, dislike: 0 };
  for (const c of counts) stats[c.direction] = c.n;

  res.json({ liked, stats });
});

module.exports = router;
