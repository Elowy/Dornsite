'use strict';

// Központi elérési utak. Alapból a projekt mappáján belül, de környezeti
// változóval felülírhatók – hasznos cPanel / megosztott tárhely esetén, ha az
// adatbázist és a feltöltéseket a public_html-en kívülre szeretnéd tenni.

const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');

const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, 'uploads');

module.exports = { DATA_DIR, UPLOAD_DIR };
