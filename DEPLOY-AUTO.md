# 🔄 Automatikus deploy cPanelre

Ez az útmutató beállítja, hogy a `main` ágra kerülő módosítások **automatikusan
feltöltődjenek** a cPanel-es webszerverre. Két módszer közül választhatsz — az
**A) GitHub Actions** az igazán automatikus (merge után magától deployol), a
**B) cPanel natív Git** pedig a cPanel felületéről indítható.

> Előfeltétel: az alkalmazás **első** beállítása egyszer kézzel történik a
> `DEPLOY-CPANEL.md` szerint (Setup Node.js App, adatbázis, `npm install`).
> Az itteni automatizálás ezután a kód frissítését végzi.

---

## A) GitHub Actions – FTP auto-deploy (ajánlott)

A repóban már ott a workflow: `.github/workflows/deploy.yml`. Minden `main`-re
történő push (pl. PR merge) után feltölti a változott fájlokat FTP-vel, és
újraindítja a Node appot. Csak be kell állítani a hozzáférést.

### 1. FTP-adatok a cPanelből
cPanel → **FTP Accounts**. Használhatod a fő fiókot, vagy hozz létre egy külön
FTP-fiókot, aminek a gyökere rögtön az alkalmazás mappája (biztonságosabb).
Jegyezd fel: **szerver (host), felhasználónév, jelszó**.

### 2. GitHub secretek és változók
A GitHub repóban: **Settings → Secrets and variables → Actions**.

**Secrets** (New repository secret):

| Név | Érték |
|---|---|
| `FTP_SERVER` | az FTP-szerver címe (pl. `ftp.a-domainem.hu` vagy a szerver hostneve) |
| `FTP_USERNAME` | az FTP-felhasználónév |
| `FTP_PASSWORD` | az FTP-jelszó |
| `FTP_SERVER_DIR` | az app mappája az FTP-home-hoz képest, **perjellel a végén** (pl. `dornsite/`, vagy dedikált FTP-fióknál `./`) |

**Variables** (Variables fül):

| Név | Érték |
|---|---|
| `DEPLOY_ENABLED` | `true` — ez kapcsolja be a deployt |
| `FTP_PROTOCOL` | *(opcionális)* `ftps` (alap, titkosított) vagy `ftp` |
| `FTP_PORT` | *(opcionális)* alapból `21` |

> Amíg a `DEPLOY_ENABLED` nincs `true`, a workflow kihagyódik – nincs hibajelzés.

### 3. Aktiválás
Állítsd be a fenti secreteket + `DEPLOY_ENABLED=true`, majd push-olj a `main`-re
(vagy indítsd kézzel: **Actions → Deploy to cPanel → Run workflow**). A futás az
**Actions** fülön követhető.

### Mit csinál és mit nem
- ✅ Feltölti a forrásfájlokat (kód, `public/`, `db/`, `routes/`).
- ✅ Frissíti a `tmp/restart.txt`-t → a Passenger **újraindítja** az appot.
- 🚫 A `data/` és `uploads/` mappát **nem** bántja (kimarad), így az adatbázis és a
  feltöltések megmaradnak.
- 🚫 A `node_modules`-t **nem** tölti fel (túl nagy/lassú FTP-n). Ez a szerveren
  marad az első `npm install`-ból.

### Ha megváltozik egy függőség (package.json)
Ilyenkor a szerveren frissíteni kell a csomagokat: cPanel → **Setup Node.js App**
→ **Run NPM Install**, majd **Restart**. (Ez ritkán fordul elő; a mindennapi
kód-módosításokhoz nem kell.)

---

## B) cPanel natív Git (`.cpanel.yml`)

Ha inkább a cPanel Git felületét használnád: a repóban van egy `.cpanel.yml`,
ami a deploykor a helyükre másolja a fájlokat és újraindítja a Passengert.

1. cPanel → **Git™ Version Control** → a repo klónozása (privát GitHub repóhoz
   deploy key kell, vagy használj cPanelen tárolt repót, amibe pusholsz).
2. Írd át a `.cpanel.yml`-ben a `DEPLOYPATH`-ot a saját elérési utadra
   (`/home/FELHASZNALO/dornsite`).
3. Új commit után a cPanelben: **Pull or Deploy → Deploy HEAD Commit**.

> A cPanel natív Git alapból **nem** húzza le magától a GitHub push-okat – a
> deployt a cPanelben indítod (vagy pull után). Ha teljesen automatikus, push
> utáni deployt szeretnél, az **A) módszer** a megfelelő.

---

## Melyiket válaszd?

| Szempont | A) GitHub Actions FTP | B) cPanel natív Git |
|---|---|---|
| Push után automatikus | ✅ igen | ⚠️ manuális deploy a cPanelben |
| Beállítás | GitHub secretek | cPanel Git + `.cpanel.yml` |
| Node függőség frissítés | cPanelben `npm install` | cPanelben `npm install` |
| Titkosított átvitel | FTPS | SSH (cPanel belső) |

A legtöbb esetben az **A) GitHub Actions FTP** a legkényelmesebb: beállítod
egyszer, utána minden merge magától kikerül a webszerverre.

---

## Biztonság
- A hozzáférési adatok **GitHub Secretként** tárolódnak (titkosítva) – soha ne
  tedd őket a kódba vagy commitba.
- Használj lehetőleg **FTPS**-t (titkosított FTP), és külön, csak az app
  mappájára jogosult FTP-fiókot.
- Éles környezetben az `.env` fájlt (jelszavak, `GOOGLE_CLIENT_ID`,
  `ADMIN_PASSWORD`, DB-adatok) a szerveren tartsd; a deploy nem írja felül.
