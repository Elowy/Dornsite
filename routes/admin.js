'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const data = require('../db');
const { UPLOAD_DIR } = require('../paths');

const router = express.Router();

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

router.post('/upload', requireAdmin, upload.array('files', 20), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'Nincs feltöltött fájl' });
    }
    const titleBase = (req.body.title || '').trim();

    const items = files.map((f) => ({
      title: titleBase,
      type: /^video\//.test(f.mimetype) ? 'video' : 'image',
      filename: f.filename,
      mime: f.mimetype,
    }));

    const count = await data.addContent(items);
    res.json({ ok: true, count });
  } catch (err) {
    next(err);
  }
});

// --- Tartalom lista + statisztikák ---
router.get('/content', requireAdmin, async (req, res, next) => {
  try {
    const rows = await data.listContent();
    const content = rows.map((r) => ({ ...r, url: `/uploads/${r.filename}`, active: !!r.active }));
    res.json({ content });
  } catch (err) {
    next(err);
  }
});

// --- Összesített statisztika (dashboard) ---
router.get('/stats', requireAdmin, async (req, res, next) => {
  try {
    const s = await data.getStats();
    s.topLiked = s.topLiked.map((r) => ({ ...r, url: `/uploads/${r.filename}` }));
    res.json(s);
  } catch (err) {
    next(err);
  }
});

// --- Tartalom aktív/inaktív kapcsolása ---
router.patch('/content/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const found = await data.setActive(id, !!req.body.active);
    if (!found) return res.status(404).json({ error: 'Nem található' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// --- Tartalom törlése (fájllal együtt) ---
router.delete('/content/:id', requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const filename = await data.deleteContent(id);
    if (!filename) return res.status(404).json({ error: 'Nem található' });

    fs.unlink(path.join(UPLOAD_DIR, filename), () => {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
