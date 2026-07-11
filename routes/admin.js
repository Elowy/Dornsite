'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// --- Egyszerű, tokenes admin munkamenet ---
const sessions = new Set();

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.cookies.admin_token;
  if (token && sessions.has(token)) return next();
  return res.status(401).json({ error: 'Nincs jogosultság' });
}

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    const token = newToken();
    sessions.add(token);
    res.cookie('admin_token', token, { httpOnly: true, sameSite: 'lax' });
    return res.json({ ok: true, token });
  }
  return res.status(401).json({ error: 'Hibás jelszó' });
});

router.post('/logout', requireAdmin, (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : req.cookies.admin_token;
  sessions.delete(token);
  res.clearCookie('admin_token');
  res.json({ ok: true });
});

router.get('/check', requireAdmin, (req, res) => res.json({ ok: true }));

// --- Fájlfeltöltés ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB / fájl
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype) || /^video\//.test(file.mimetype)) {
      return cb(null, true);
    }
    cb(new Error('Csak kép vagy videó tölthető fel'));
  },
});

router.post('/upload', requireAdmin, upload.array('files', 20), (req, res) => {
  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ error: 'Nincs feltöltött fájl' });
  }
  const titleBase = (req.body.title || '').trim();

  const insert = db.prepare(
    `INSERT INTO content (title, type, filename, mime) VALUES (?, ?, ?, ?)`
  );
  const inserted = [];
  const tx = db.transaction((list) => {
    for (const f of list) {
      const type = /^video\//.test(f.mimetype) ? 'video' : 'image';
      const info = insert.run(titleBase, type, f.filename, f.mimetype);
      inserted.push(info.lastInsertRowid);
    }
  });
  tx(files);

  res.json({ ok: true, count: inserted.length });
});

// --- Tartalom lista + statisztikák ---
router.get('/content', requireAdmin, (req, res) => {
  const rows = db
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
    .map((r) => ({ ...r, url: `/uploads/${r.filename}`, active: !!r.active }));

  res.json({ content: rows });
});

// --- Összesített statisztika (dashboard) ---
router.get('/stats', requireAdmin, (req, res) => {
  const totalContent = db.prepare('SELECT COUNT(*) AS n FROM content').get().n;
  const activeContent = db.prepare('SELECT COUNT(*) AS n FROM content WHERE active = 1').get().n;
  const totalVotes = db.prepare('SELECT COUNT(*) AS n FROM votes').get().n;
  const totalLikes = db.prepare("SELECT COUNT(*) AS n FROM votes WHERE direction = 'like'").get().n;
  const totalDislikes = totalVotes - totalLikes;
  const sessions = db.prepare('SELECT COUNT(DISTINCT session_id) AS n FROM votes').get().n;

  const topLiked = db
    .prepare(
      `SELECT c.id, c.title, c.filename, c.type,
              COUNT(*) AS likes
         FROM votes v JOIN content c ON c.id = v.content_id
        WHERE v.direction = 'like'
        GROUP BY c.id ORDER BY likes DESC LIMIT 5`
    )
    .all()
    .map((r) => ({ ...r, url: `/uploads/${r.filename}` }));

  res.json({
    totalContent,
    activeContent,
    totalVotes,
    totalLikes,
    totalDislikes,
    sessions,
    topLiked,
  });
});

// --- Tartalom aktív/inaktív kapcsolása ---
router.patch('/content/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const active = req.body.active ? 1 : 0;
  const info = db.prepare('UPDATE content SET active = ? WHERE id = ?').run(active, id);
  if (info.changes === 0) return res.status(404).json({ error: 'Nem található' });
  res.json({ ok: true });
});

// --- Tartalom törlése (fájllal együtt) ---
router.delete('/content/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = db.prepare('SELECT filename FROM content WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Nem található' });

  db.prepare('DELETE FROM content WHERE id = ?').run(id);

  const filePath = path.join(UPLOAD_DIR, row.filename);
  fs.unlink(filePath, () => {});

  res.json({ ok: true });
});

module.exports = router;
