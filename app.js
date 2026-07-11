'use strict';

// Belépési pont cPanel / Phusion Passenger számára.
// A cPanel "Setup Node.js App" alapértelmezett indítófájlja az app.js, ez pedig
// egyszerűen betölti a tényleges szervert (server.js). Így az `npm start`
// (node server.js) és a cPanel indítás is ugyanazt a kódot futtatja.
module.exports = require('./server.js');
