# 🚀 Telepítés cPanel-alapú tárhelyre

Ez az útmutató végigvezet a Dornsite telepítésén egy cPanel-es (Node.js-t
támogató) tárhelyen. A cPanel a Node.js appokat a **Phusion Passenger**
alkalmazásszerverrel futtatja, amit a **Setup Node.js App** felületen keresztül
kezelsz.

> **Fontos:** a tárhelynek támogatnia kell a Node.js alkalmazásokat (van
> „Setup Node.js App" ikon a cPanel-ben). A legtöbb CloudLinux + cPanel/LiteSpeed
> tárhelyen van. Ha nincs, kérd a szolgáltatót, vagy válassz Node.js-t támogató
> csomagot.

---

## 1. A fájlok feltöltése

Két lehetőség:

**A) Git (ajánlott, ha van SSH/Git a cPanel-ben)**
- cPanel → **Git Version Control** → *Create* → add meg a repo URL-t, és klónozd
  pl. a `dornsite` mappába (a `public_html`-en **kívül**, pl. `/home/felhasznalo/dornsite`).

**B) Kézi feltöltés**
- Csomagold zip-be a projektet a **`node_modules`, `data`, `uploads` mappák
  nélkül** (ezek a szerveren jönnek létre).
- cPanel → **File Manager** → töltsd fel és csomagold ki egy mappába
  (pl. `/home/felhasznalo/dornsite`).

Az alkalmazás gyökere lehet a `public_html`-en kívül is – a Passenger a saját URL
alá csatolja, nem kell a webgyökérbe tenni.

---

## 2. MySQL adatbázis létrehozása (ajánlott)

A cPanel natívan támogatja a MySQL-t, ezért éles környezetben ezt érdemes
használni (a beágyazott SQLite helyett).

cPanel → **MySQL® Databases**:

1. **Create New Database** – pl. `dornsite`. A cPanel prefixet tesz elé, így a
   teljes neve valami ilyesmi lesz: `felhasznalo_dornsite`.
2. **Add New User** – hozz létre egy DB-felhasználót erős jelszóval (pl.
   `felhasznalo_dbuser`).
3. **Add User To Database** – rendeld a felhasználót az adatbázishoz, és adj neki
   **ALL PRIVILEGES** jogot.

Jegyezd fel a teljes adatbázisnevet, felhasználónevet és jelszót – ezek kellenek
a környezeti változókhoz (3. lépés). A táblákat az alkalmazás az első indításkor
**automatikusan létrehozza**.

> Ha inkább a beágyazott SQLite-ot használnád (nincs külön adatbázis), hagyd ki
> ezt a lépést, és a 3. lépésnél állítsd be a `DB_DRIVER=sqlite` változót.

---

## 3. Node.js alkalmazás létrehozása

cPanel → **Setup Node.js App** → **Create Application**:

| Mező | Érték |
|---|---|
| **Node.js version** | 18, 20 vagy 22 (LTS) |
| **Application mode** | `Production` |
| **Application root** | a feltöltött mappa, pl. `dornsite` |
| **Application URL** | ahová szeretnéd (pl. a domain gyökere, vagy `/dornsite`) |
| **Application startup file** | `app.js` |

Kattints a **Create** gombra.

---

## 4. Környezeti változók

Ugyanezen az oldalon, a **Environment variables** résznél add hozzá:

| Név | Érték |
|---|---|
| `ADMIN_PASSWORD` | **egyedi, erős jelszó** (ne az alap `admin123`!) |
| `AUTH_SECRET` | hosszú, véletlen szöveg (a felhasználói tokenek aláírásához) |
| `GOOGLE_CLIENT_ID` | *(opcionális)* Google OAuth kliens-azonosító a Google belépéshez |
| `NODE_ENV` | `production` |
| `DB_DRIVER` | `mysql` |
| `DB_HOST` | `localhost` (a legtöbb cPanel-en ez jó) |
| `DB_PORT` | `3306` |
| `DB_USER` | a 2. lépésben létrehozott DB-felhasználó (pl. `felhasznalo_dbuser`) |
| `DB_PASSWORD` | a DB-felhasználó jelszava |
| `DB_NAME` | a 2. lépésben létrehozott adatbázis (pl. `felhasznalo_dornsite`) |

Ha inkább **SQLite**-ot használnál (2. lépés kihagyva), csak `DB_DRIVER=sqlite`-ot
állíts be, a `DB_*` változók nem kellenek.

Opcionálisan, ha a feltöltött fájlokat a webgyökéren kívül szeretnéd tárolni:

| Név | Érték |
|---|---|
| `UPLOAD_DIR` | pl. `/home/felhasznalo/dornsite-uploads` |

> A `PORT`-ot **nem** kell megadni – a Passenger kezeli.

Mentés után kattints a **Save** gombra.

---

## 5. Függőségek telepítése

A Setup Node.js App oldalon:

1. Kattints a **Run NPM Install** gombra (ez a kiválasztott Node-verzióhoz
   telepíti a csomagokat).
2. Várd meg, amíg végez.

Ha SSH-d van, ugyanez a cPanel virtualenv-ből:

```bash
# a cPanel a létrehozáskor kiír egy "source ...activate" parancsot – futtasd,
# majd:
cd ~/dornsite
npm install
```

> A MySQL driver (`mysql2`) tiszta JavaScript, nem kell hozzá fordítás. A
> `better-sqlite3` csak **opcionális** függőség (a SQLite driverhez kell) – ha a
> tárhely nem tudja lefordítani, a telepítés akkor is sikeres, és az app
> MySQL-lel fut.

---

## 6. Indítás / újraindítás

- A **Setup Node.js App** oldalon a **Restart** gombbal indítsd/újraindítsd.
- Nyisd meg az **Application URL**-t → megjelenik a swipe felület.
- Az admin panel: `<URL>/admin.html`.

Első lépésként lépj be az admin panelre, és tölts fel néhány kép/videó tartalmat.

---

## 7. Írási jogok és fájlméret

- Az `uploads/` mappának (és SQLite esetén a `data/`-nak) **írhatónak** kell
  lennie. Ugyanazzal a felhasználóval futnak, mint a fájljaid, így alapból rendben
  van. A mappákat az app első indításkor automatikusan létrehozza.
- **Feltöltési méretkorlát:** az app fájlonként 20 MB-ot enged. A webszerver
  (Apache/LiteSpeed) ennél szigorúbb lehet. Nagyobb videókhoz emeld meg a
  `public_html`-ben (vagy az app mappában) egy `.htaccess`-szel:

  ```apache
  # Apache
  LimitRequestBody 52428800

  # PHP-alapú limitek egyes tárhelyeken (ha érvényesek):
  # php_value upload_max_filesize 50M
  # php_value post_max_size 50M
  ```

  LiteSpeed esetén a body-méret a szolgáltatónál állítható.

---

## 8. Frissítés új verzióra

**Git esetén:**
```bash
cd ~/dornsite
git pull
# ha változott a package.json: Run NPM Install a cPanel-ben
```
majd **Restart** a Setup Node.js App oldalon.

**Kézi esetén:** töltsd fel a módosult fájlokat (a `data/` és `uploads/`
mappát **ne** írd felül!), majd **Restart**.

---

## 9. Hibaelhárítás

**„503 Service Unavailable" / az app nem indul**
- Nézd meg a naplót: az Application root-ban a `stderr.log`, vagy a
  Setup Node.js App → logs. A Passenger a `console.log`/hibákat ide írja.
- Ellenőrizd, hogy az **Application startup file** = `app.js`.

**Adatbázis kapcsolati hiba (`ECONNREFUSED`, `Access denied`, `Unknown database`)**
- Ellenőrizd a `DB_HOST` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` értékeket –
  a `DB_NAME` és `DB_USER` a cPanel-prefixet is tartalmazza (pl. `felhasznalo_...`).
- A DB-felhasználó legyen **hozzárendelve** az adatbázishoz (MySQL Databases →
  Add User To Database), ALL PRIVILEGES joggal.
- A `DB_HOST` a legtöbb cPanel-en `localhost`; ha a szolgáltató mást ír elő,
  használd azt.

**`better-sqlite3` telepítési hiba (csak SQLite driver esetén)**
- A `better-sqlite3` opcionális függőség; ha nem tudja lefordítani, a MySQL
  driver akkor is működik. Válts `DB_DRIVER=mysql`-re, vagy próbáld Node
  **18/20/22 LTS**-sel (ezekhez van előfordított bináris).

**A feltöltött képek nem jelennek meg**
- Ellenőrizd, hogy az `uploads/` (vagy a `UPLOAD_DIR`) írható, és hogy a
  `/uploads/...` URL elérhető (a Node app szolgálja ki, nem az Apache).

**Az admin belépés „kiléptet" újraindítás után**
- Ez normális: az admin munkamenetek memóriában vannak, a Passenger
  újraindításkor törlődnek. Egyszerűen lépj be újra.

---

## Összefoglaló checklista

- [ ] Fájlok feltöltve (node_modules/data/uploads nélkül)
- [ ] MySQL adatbázis + felhasználó létrehozva, összerendelve (vagy SQLite választva)
- [ ] Node.js App létrehozva, **startup file = app.js**, Node 18/20/22
- [ ] `ADMIN_PASSWORD`, `NODE_ENV=production` és a `DB_*` változók beállítva
- [ ] **Run NPM Install** lefutott
- [ ] **Restart**, az URL betölt
- [ ] Admin belépés működik, tartalom feltölthető
