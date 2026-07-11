'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');

const { UPLOAD_DIR } = require('./paths');
const contentRoutes = require('./routes/content');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// cPanel / Passenger Apache proxy mögött a helyes protokoll/IP felismeréséhez
app.set('trust proxy', true);

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(express.json());
app.use(cookieParser());

// Feltöltött tartalmak kiszolgálása
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// API útvonalak
app.use('/api', contentRoutes);
app.use('/api/admin', adminRoutes);

// Statikus frontend
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Dornsite fut: http://localhost:${PORT}`);
  console.log(`Admin panel:  http://localhost:${PORT}/admin.html`);
});

// cPanel / Phusion Passenger a modult is betöltheti indítófájlként
module.exports = app;
