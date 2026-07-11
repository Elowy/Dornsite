'use strict';

const express = require('express');
const data = require('../db');

const router = express.Router();

// Véletlenszerű kártyák lekérése, amikre az adott session még nem szavazott
router.get('/cards', async (req, res, next) => {
  try {
    const sessionId = String(req.query.session || '').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 30);
    if (!sessionId) return res.status(400).json({ error: 'Hiányzó session azonosító' });

    const rows = await data.getCards(sessionId, limit);
    const cards = rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      url: `/uploads/${r.filename}`,
    }));
    res.json({ cards });
  } catch (err) {
    next(err);
  }
});

// Szavazat leadása (like = jobbra, dislike = balra)
router.post('/vote', async (req, res, next) => {
  try {
    const { contentId, direction, session } = req.body || {};
    const sessionId = String(session || '').trim();

    if (!sessionId) return res.status(400).json({ error: 'Hiányzó session azonosító' });
    if (!['like', 'dislike'].includes(direction)) {
      return res.status(400).json({ error: 'Érvénytelen irány' });
    }

    if (!(await data.contentActiveExists(contentId))) {
      return res.status(404).json({ error: 'A tartalom nem található' });
    }

    await data.vote(contentId, sessionId, direction);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Az adott session statisztikái + kedvelt tartalmak ("matchek")
router.get('/likes', async (req, res, next) => {
  try {
    const sessionId = String(req.query.session || '').trim();
    if (!sessionId) return res.status(400).json({ error: 'Hiányzó session azonosító' });

    const { liked, stats } = await data.getLikesAndStats(sessionId);
    res.json({
      liked: liked.map((r) => ({ id: r.id, title: r.title, type: r.type, url: `/uploads/${r.filename}` })),
      stats,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
