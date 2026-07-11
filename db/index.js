'use strict';

// Adat-hozzáférési réteg. A tényleges adatbázist a DB_DRIVER környezeti változó
// választja ki:
//   DB_DRIVER=mysql   → MySQL / MariaDB (ajánlott cPanel-en)
//   DB_DRIVER=sqlite  → beágyazott SQLite (alap, nulla-konfig helyi fejlesztéshez)
// Ha nincs megadva: MySQL, ha van DB_HOST beállítva, egyébként SQLite.

const name = (
  process.env.DB_DRIVER || (process.env.DB_HOST ? 'mysql' : 'sqlite')
).toLowerCase();

const impl = require(name === 'mysql' ? './mysql' : './sqlite');
impl.driverName = name;

module.exports = impl;
