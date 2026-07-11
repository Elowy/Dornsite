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

## 2. Node.js alkalmazás létrehozása

cPanel → **Setup Node.js App** → **Create Application**:

| Mező | Érték |
|---|---|
| **Node.js version** | 18, 20 vagy 22 (a `better-sqlite3` ezekhez ad előfordított bináris fájlt) |
| **Application mode** | `Production` |
| **Application root** | a feltöltött mappa, pl. `dornsite` |
| **Application URL** | ahová szeretnéd (pl. a domain gyökere, vagy `/dornsite`) |
| **Application startup file** | `app.js` |

Kattints a **Create** gombra.

---

## 3. Környezeti változók

Ugyanezen az oldalon, a **Environment variables** résznél add hozzá:

| Név | Érték |
|---|---|
| `ADMIN_PASSWORD` | **egyedi, erős jelszó** (ne az alap `admin123`!) |
| `NODE_ENV` | `production` |

Opcionálisan, ha az adatokat a webgyökéren kívül szeretnéd tárolni:

| Név | Érték |
|---|---|
| `DATA_DIR` | pl. `/home/felhasznalo/dornsite-data` |
| `UPLOAD_DIR` | pl. `/home/felhasznalo/dornsite-uploads` |

> A `PORT`-ot **nem** kell megadni – a Passenger kezeli.

Mentés után kattints a **Save** gombra.

---

## 4. Függőségek telepítése

A Setup Node.js App oldalon:

1. Kattints a **Run NPM Install** gombra (ez a megfelelő Node-verzióhoz telepíti
   a csomagokat, beleértve a `better-sqlite3` natív modult is).
2. Várd meg, amíg végez.

Ha SSH-d van, ugyanez a cPanel virtualenv-ből:

```bash
# a cPanel a létrehozáskor kiír egy "source ...activate" parancsot – futtasd,
# majd:
cd ~/dornsite
npm install
```

---

## 5. Indítás / újraindítás

- A **Setup Node.js App** oldalon a **Restart** gombbal indítsd/újraindítsd.
- Nyisd meg az **Application URL**-t → megjelenik a swipe felület.
- Az admin panel: `<URL>/admin.html`.

Első lépésként lépj be az admin panelre, és tölts fel néhány kép/videó tartalmat.

---

## 6. Írási jogok és fájlméret

- A `data/` (SQLite adatbázis) és `uploads/` mappáknak **írhatónak** kell lenniük.
  Ugyanazzal a felhasználóval futnak, mint a fájljaid, így alapból rendben van.
  A mappákat az app első indításkor automatikusan létrehozza.
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

## 7. Frissítés új verzióra

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

## 8. Hibaelhárítás

**„503 Service Unavailable" / az app nem indul**
- Nézd meg a naplót: az Application root-ban a `stderr.log`, vagy a
  Setup Node.js App → logs. A Passenger a `console.log`/hibákat ide írja.
- Ellenőrizd, hogy az **Application startup file** = `app.js`.

**`better-sqlite3` telepítési hiba (native build)**
- A `better-sqlite3` előfordított binárist tölt le a kiválasztott Node-verzióhoz.
  Ha a build mégis elindul és elhasal, általában a Node-verzió az ok:
  válts **18/20/22 LTS**-re, majd **Run NPM Install** újra.
- Ritka esetben hiányoznak a fordítóeszközök (python/make/gcc) a tárhelyen –
  ilyenkor a fenti LTS-verziók előfordított binárisa a megoldás, vagy kérd a
  szolgáltató segítségét. (Ha a tárhelyed egyáltalán nem tud natív modult
  futtatni, szólj – át tudom állítani az adattárolást natív függőség nélküli
  megoldásra.)

**A feltöltött képek nem jelennek meg**
- Ellenőrizd, hogy az `uploads/` (vagy a `UPLOAD_DIR`) írható, és hogy a
  `/uploads/...` URL elérhető (a Node app szolgálja ki, nem az Apache).

**Az admin belépés „kiléptet" újraindítás után**
- Ez normális: az admin munkamenetek memóriában vannak, a Passenger
  újraindításkor törlődnek. Egyszerűen lépj be újra.

---

## Összefoglaló checklista

- [ ] Fájlok feltöltve (node_modules/data/uploads nélkül)
- [ ] Node.js App létrehozva, **startup file = app.js**, Node 18/20/22
- [ ] `ADMIN_PASSWORD` és `NODE_ENV=production` beállítva
- [ ] **Run NPM Install** lefutott
- [ ] **Restart**, az URL betölt
- [ ] Admin belépés működik, tartalom feltölthető
