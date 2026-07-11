'use strict';

const express = require('express');
const data = require('../db');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('../auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bejelentkezett felhasználó kinyerése a tokenből (opcionális)
async function currentUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload || !payload.uid) return null;
  return data.getUserById(payload.uid);
}

// Middleware: csak bejelentkezett felhasználónak
async function requireUser(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Bejelentkezés szükséges' });
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// --- Regisztráció (helyi fiók) ---
router.post('/register', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const displayName = String(req.body.displayName || '').trim() || email.split('@')[0];

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Érvénytelen e-mail cím' });
    if (password.length < 6) {
      return res.status(400).json({ error: 'A jelszó legalább 6 karakter legyen' });
    }

    if (await data.getUserByEmail(email)) {
      return res.status(409).json({ error: 'Ezzel az e-mail címmel már van fiók' });
    }

    const user = await data.createUser({
      email,
      passwordHash: hashPassword(password),
      displayName,
      provider: 'local',
    });

    const token = signToken({ uid: user.id });
    res.json({ token, user: { id: user.id, email, displayName: user.displayName } });
  } catch (err) {
    next(err);
  }
});

// --- Bejelentkezés ---
router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const user = await data.getUserByEmail(email);
    if (!user || user.provider !== 'local' || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Hibás e-mail vagy jelszó' });
    }

    const token = signToken({ uid: user.id });
    res.json({
      token,
      user: { id: user.id, email: user.email, displayName: user.display_name },
    });
  } catch (err) {
    next(err);
  }
});

// --- Aktuális felhasználó ---
router.get('/me', async (req, res, next) => {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Nincs bejelentkezve' });
    res.json({ user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.requireUser = requireUser;
module.exports.currentUser = currentUser;
