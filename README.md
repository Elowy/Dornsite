# 🔥 Dornsite

Tinder-stílusú swipe weboldal: a feltöltött tartalmakat véletlenszerű sorrendben
mutatja, a felhasználók pedig **jobbra húzva** (tetszik) vagy **balra húzva**
(nem tetszik) értékelhetik őket. Tartozik hozzá egy **admin vezérlőpult** a
tartalmak kezeléséhez és a statisztikák megtekintéséhez, az adatok pedig egy
beágyazott **SQLite adatbázisban** tárolódnak.

## Funkciók

- 🃏 **Swipe kártyák** – egér és érintés (mobil) támogatással, valamint gombokkal
  és nyíl billentyűkkel is vezérelhető
- 🎲 **Véletlenszerű betöltés** – minden session csak olyan tartalmat lát, amire
  még nem szavazott
- ❤️ **Kedveltek** – a jobbra húzott tartalmak külön panelen visszanézhetők
- 🛠️ **Admin panel** – jelszavas belépés, kép/videó feltöltés (drag & drop),
  tartalmak elrejtése/törlése, valós idejű statisztikák
- 🗄️ **SQLite adatbázis** – nem kell külön adatbázis-szerver

## Technológia

- **Backend:** Node.js + Express
- **Adatbázis:** SQLite (`better-sqlite3`)
- **Feltöltés:** Multer
- **Frontend:** vanilla HTML/CSS/JS (nincs build lépés)

## Telepítés és futtatás

```bash
# 1. Függőségek telepítése
npm install

# 2. Környezeti változók (opcionális, de ajánlott)
cp .env.example .env
#   – állítsd be az ADMIN_PASSWORD értékét!

# 3. Indítás
npm start
```

Ezután:

- **Weboldal:** http://localhost:3000
- **Admin panel:** http://localhost:3000/admin.html

Az admin panel alapértelmezett jelszava `admin123` (a `.env` fájlban
felülírható az `ADMIN_PASSWORD` változóval).

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
(`ADMIN_PASSWORD`, `NODE_ENV`) és lefuttatni az `npm install`-t.

## Projekt szerkezete

```
app.js             – belépési pont cPanel / Passenger számára (server.js-t tölti be)
server.js          – Express szerver belépési pont
paths.js           – adat- és feltöltési mappák (env-ből felülírható)
db.js              – SQLite kapcsolat és séma
routes/
  content.js       – publikus API (kártyák, szavazás, kedveltek)
  admin.js         – admin API (belépés, feltöltés, kezelés, statisztika)
public/
  index.html/.css/.js  – swipe felület
  admin.html/.css/.js  – admin vezérlőpult
uploads/           – feltöltött fájlok (gitből kizárva)
data/              – SQLite adatbázis (gitből kizárva)
```

## Adatmodell

- **content** – feltöltött tartalom (`title`, `type`, `filename`, `active`, …)
- **votes** – szavazatok (`content_id`, `session_id`, `direction`) – sessionönként
  tartalmanként egy szavazat, felülírható

## Megjegyzés éles használathoz

Az admin munkamenetek jelenleg memóriában tárolódnak (szerver újraindításkor
kilép). Éles környezetben érdemes tartós session-tárolót, HTTPS-t és erős
`ADMIN_PASSWORD`-öt használni.
