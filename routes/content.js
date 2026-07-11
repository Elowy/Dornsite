'use strict';

const express = require('express');
const data = require('../db');
const { requireUser } = require('./auth');

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
      link: r.link || '',
      type: r.type,
      url: `/uploads/${r.filename}`,
    }));
    res.json({ cards });
  } catch (err) {
    next(err);
  }
});

// Egy adott tartalom nyilvános adatai (megosztható link / részletnézet)
router.get('/content/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const c = await data.getPublicContent(id);
    if (!c) return res.status(404).json({ error: 'A tartalom nem található' });
    res.json({
      content: { id: c.id, title: c.title, link: c.link || '', type: c.type, url: `/uploads/${c.filename}` },
    });
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
      liked: liked.map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        link: r.link || '',
        url: `/uploads/${r.filename}`,
      })),
      stats,
    });
  } catch (err) {
    next(err);
  }
});

// --- Kommentek ---
router.get('/content/:id/comments', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const comments = await data.getComments(id);
    res.json({ comments });
  } catch (err) {
    next(err);
  }
});

router.post('/content/:id/comments', requireUser, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const body = String(req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'A komment nem lehet üres' });
    if (body.length > 1000) return res.status(400).json({ error: 'A komment túl hosszú (max 1000)' });

    if (!(await data.contentActiveExists(id))) {
      return res.status(404).json({ error: 'A tartalom nem található' });
    }

    const comment = await data.addComment(id, req.user.id, body);
    res.json({ comment });
  } catch (err) {
    next(err);
  }
});

router.delete('/comments/:id', requireUser, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ok = await data.deleteComment(id, req.user.id, false);
    if (!ok) return res.status(403).json({ error: 'Nem törölhető' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
