'use strict';

// Egyszerű, függőség nélküli hitelesítés a Node beépített crypto moduljával.
// - Jelszó-hashelés: scrypt (só + hash), nincs natív modul.
// - Munkamenet-token: HMAC-aláírt token, ami újraindítás után is érvényes marad
//   (szemben a memóriában tárolt admin tokennel).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');

// --- Titkos kulcs a token aláírásához ---
// Sorrend: AUTH_SECRET env → tárolt fájl → új generált (és eltárolt) kulcs.
function loadSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, '.auth_secret');
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  } catch {
    // Ha nem írható a lemez, legalább a folyamat élettartamáig legyen kulcs.
    return crypto.randomBytes(48).toString('hex');
  }
}

const SECRET = loadSecret();
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 nap

// --- Jelszó ---
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const test = crypto.scryptSync(password, salt, 64);
    const known = Buffer.from(hash, 'hex');
    return known.length === test.length && crypto.timingSafeEqual(known, test);
  } catch {
    return false;
  }
}

// --- Token (base64url(payload).base64url(hmac)) ---
function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signToken(payload) {
  const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  try {
    const [data, sig] = String(token).split('.');
    if (!data || !sig) return null;
    const expected = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
