# 🔥 Dornsite

Tinder-stílusú swipe weboldal: a feltöltött tartalmakat véletlenszerű sorrendben
mutatja, a felhasználók pedig **jobbra húzva** (tetszik) vagy **balra húzva**
(nem tetszik) értékelhetik őket. Tartozik hozzá egy **admin vezérlőpult** a
tartalmak kezeléséhez és a statisztikák megtekintéséhez, az adatok pedig
**MySQL/MariaDB** vagy (helyi fejlesztéshez) beágyazott **SQLite** adatbázisban
tárolódnak.

## Funkciók

- 🃏 **Swipe kártyák** – egér és érintés (mobil) támogatással, valamint gombokkal
  és nyíl billentyűkkel is vezérelhető
- 🎲 **Véletlenszerű betöltés** – minden session csak olyan tartalmat lát, amire
  még nem szavazott
- ❤️ **Kedveltek** – a jobbra húzott tartalmak külön panelen visszanézhetők
- 👤 **Felhasználói fiókok** – helyi regisztráció/belépés (e-mail + jelszó) és
  **Google-bejelentkezés** (opcionális, a `GOOGLE_CLIENT_ID` beállításával aktív)
- 🔥 **„Match" élmény** – jobbra húzáskor ünneplő felugró; népszerű (sokak által
  kedvelt) tartalomnál külön „Match!" élmény
- 🔔 **Értesítések** – bejelentkezett felhasználók harang ikonnal értesülnek, ha
  valaki hozzászól egy tartalomhoz, amihez ők is kommenteltek
- 💬 **Kommentek** – a bejelentkezett felhasználók hozzászólhatnak a tartalmakhoz
- 🏷️ **Címkék és szűrés** – a tartalmakhoz címkék rendelhetők, a főoldalon
  címke-sávval szűrhető a swipe-olható tartalom
- 🔗 **Link a tartalomhoz** – minden tartalomhoz megadható egy külső hivatkozás
- ↗ **Megosztás** – megosztható mélylink minden tartalomhoz (`/?c=ID`), a
  natív megosztóval vagy vágólapra másolással
- 🛠️ **Admin panel** – jelszavas belépés, kép/videó feltöltés (drag & drop),
  cím/link szerkesztés, tartalmak elrejtése/törlése, valós idejű statisztikák
- 🗄️ **Két adatbázis-driver** – MySQL/MariaDB (éles, pl. cPanel) vagy SQLite
  (nulla-konfig helyi fejlesztéshez), a `DB_DRIVER` env változóval választható

## Technológia

- **Backend:** Node.js + Express
- **Adatbázis:** MySQL/MariaDB (`mysql2`) vagy SQLite (`better-sqlite3`) –
  közös adat-réteg mögött (`data/`), env-ből választható
- **Feltöltés:** Multer
- **Frontend:** vanilla HTML/CSS/JS (nincs build lépés)

## Telepítés és futtatás

```bash
# 1. Függőségek telepítése
npm install

# 2. Környezeti változók (opcionális, de ajánlott)
cp .env.example .env
#   – állítsd be az ADMIN_PASSWORD értékét!
#   – helyi futtatáshoz nem kell adatbázis-szerver: alapból SQLite fut.

# 3. Indítás
npm start
```

Ezután:

- **Weboldal:** http://localhost:3000
- **Admin panel:** http://localhost:3000/admin.html

Az admin panel alapértelmezett jelszava `admin123` (a `.env` fájlban
felülírható az `ADMIN_PASSWORD` változóval).

### Adatbázis kiválasztása

- **SQLite** (alap): nem kell semmit beállítani, a `data/` mappában jön létre.
- **MySQL/MariaDB:** állítsd be a `.env`-ben: `DB_DRIVER=mysql`, majd a
  `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` értékeket. A táblákat
  az app az első indításkor automatikusan létrehozza.

## Használat

1. Nyisd meg az **admin panelt**, jelentkezz be, és tölts fel néhány képet/videót.
2. Nyisd meg a **főoldalt** – ott jelennek meg a kártyák véletlenszerű sorrendben.
3. Húzd **jobbra** ami tetszik, **balra** amit nem, vagy használd a gombokat /
   nyíl billentyűket.

## Telepítés cPanel-alapú tárhelyre

A cPanel-es (Node.js-t támogató) tárhelyre való telepítés lépésről lépésre a
[**DEPLOY-CPANEL.md**](DEPLOY-CPANEL.md) fájlban található. Röviden: a Phusion
Passenger futtatja az appot, az indítófájl az `app.js`, és a **Setup Node.js
App** felületen kell beállítani a Node-verziót, a környezeti változókat
(`ADMIN_PASSWORD`, `NODE_ENV`, valamint a MySQL-hez a `DB_*` változók) és
lefuttatni az `npm install`-t. Az útmutató a MySQL adatbázis cPanel-es
létrehozását is tartalmazza.

### Automatikus deploy (CI/CD)

A módosítások automatikus feltöltése a cPanel tárhelyre a
[**DEPLOY-AUTO.md**](DEPLOY-AUTO.md) szerint állítható be. A repóban van egy
GitHub Actions workflow (`.github/workflows/deploy.yml`), ami a `main` ág
frissülésekor FTP-vel felmásolja a változásokat és újraindítja a Node appot;
valamint egy `.cpanel.yml` a cPanel natív Git-deployhoz.

## Projekt szerkezete

```
app.js             – belépési pont cPanel / Passenger számára (server.js-t tölti be)
server.js          – Express szerver belépési pont (adatbázis init + indítás)
paths.js           – feltöltési és (SQLite) adatmappa (env-ből felülírható)
auth.js            – jelszó-hashelés (scrypt) és aláírt munkamenet-token (HMAC)
db/
  index.js         – driver-választó (DB_DRIVER alapján)
  mysql.js         – MySQL/MariaDB implementáció (mysql2)
  sqlite.js        – SQLite implementáció (better-sqlite3)
routes/
  auth.js          – felhasználói fiók API (regisztráció, belépés, /me)
  content.js       – publikus API (kártyák, szavazás, kedveltek, kommentek)
  admin.js         – admin API (belépés, feltöltés, kezelés, statisztika)
public/
  index.html/.css/.js  – swipe felület
  admin.html/.css/.js  – admin vezérlőpult
uploads/           – feltöltött fájlok (gitből kizárva)
```

## Adatmodell

Mindkét driver ugyanazt a sémát hozza létre automatikusan:

- **content** – feltöltött tartalom (`title`, `link`, `type`, `filename`, `active`, …)
- **votes** – szavazatok (`content_id`, `session_id`, `direction`) – sessionönként
  tartalmanként egy szavazat, felülírható (upsert)
- **users** – felhasználói fiókok (`email`, `password_hash`, `display_name`,
  `provider`, `provider_id`) – a `provider`/`provider_id` a későbbi Google-belépéshez
- **comments** – hozzászólások (`content_id`, `user_id`, `body`)
- **tags** / **content_tags** – címkék és a tartalmakhoz rendelésük (many-to-many)
- **notifications** – felhasználói értesítések (`user_id`, `type`, `content_id`, …)

### Felhasználói fiókok és a jövőbeli Google-belépés

A helyi regisztráció e-mail + jelszó alapú (a jelszó `scrypt`-tel hashelve, natív
függőség nélkül). A munkamenet HMAC-aláírt token, ami a szerver újraindítását is
túléli – ehhez érdemes beállítani egy állandó `AUTH_SECRET` env változót
(egyébként a rendszer generál egyet és a `data/` mappába menti).

**Google-bejelentkezés.** Ha beállítod a `GOOGLE_CLIENT_ID` env változót, a
bejelentkező ablakban megjelenik a Google-gomb (Google Identity Services). A
frontend a Google ID tokent a `/api/auth/google` végpontra küldi, a szerver pedig
a hivatalos `google-auth-library`-vel ellenőrzi, majd `provider='google'` fiókot
hoz létre/keres, és ugyanazt a saját tokent adja vissza – a komment- és
kedvelés-rendszer változatlanul működik. Beállítás:

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID**
   → *Web application*.
2. Az **Authorized JavaScript origins** közé vedd fel a webhelyed URL-jét
   (pl. `https://a-domainem.hu`).
3. A kapott **Client ID**-t add meg a `GOOGLE_CLIENT_ID` env változóban. (Titkos
   kulcs nem szükséges, mert csak ID token ellenőrzés történik.)

## Megjegyzés éles használathoz

Az admin munkamenetek jelenleg memóriában tárolódnak (szerver újraindításkor
kilép). Éles környezetben érdemes tartós session-tárolót, HTTPS-t és erős
`ADMIN_PASSWORD`-öt használni.
