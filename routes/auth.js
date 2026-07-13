'use strict';

const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const data = require('../db');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('../auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Google bejelentkezés csak akkor aktív, ha be van állítva a kliens-azonosító.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

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

// --- Kliens konfiguráció (a frontend ebből tudja, aktív-e a Google belépés) ---
router.get('/config', (req, res) => {
  res.json({ google: !!googleClient, googleClientId: GOOGLE_CLIENT_ID });
});

// --- Google bejelentkezés (ID token ellenőrzése) ---
router.post('/google', async (req, res, next) => {
  try {
    if (!googleClient) {
      return res.status(400).json({ error: 'A Google belépés nincs beállítva' });
    }
    const credential = String(req.body.credential || '');
    if (!credential) return res.status(400).json({ error: 'Hiányzó Google token' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'Érvénytelen Google token' });
    }

    const sub = payload.sub;
    const email = String(payload.email || '').toLowerCase();
    const displayName = payload.name || (email ? email.split('@')[0] : 'Google felhasználó');

    // 1) meglévő Google-fiók  2) azonos e-mailű meglévő fiók  3) új fiók
    let user =
      (await data.getUserByProvider('google', sub)) ||
      (email ? await data.getUserByEmail(email) : null);

    if (!user) {
      user = await data.createUser({
        email,
        passwordHash: '',
        displayName,
        provider: 'google',
        providerId: sub,
      });
      user = { id: user.id, email, display_name: displayName };
    }

    const token = signToken({ uid: user.id });
    res.json({
      token,
      user: { id: user.id, email: user.email, displayName: user.display_name || displayName },
    });
  } catch (err) {
    next(err);
  }
});

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
