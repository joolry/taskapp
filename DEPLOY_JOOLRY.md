# Joolry Daily — Deploy Guide

**App Name:** Joolry Daily  
**Repo:** https://github.com/joolry/dailyapp  
**Theme:** Black / Cream / Soft coral (matches joolry.in)

---

## Files ready in `/artifacts`

| File | Action |
|------|--------|
| `index.html` | Main SPA — Joolry branded + new theme |
| `app.js` | Core utils (session key updated) |
| `appconfig.js` | App name, session, GAS_URL |
| `Code.gs` | Sheet IDs + WA credentials updated |
| `manifest.json` | PWA config for Joolry Daily |
| `sw.js` | Service worker cache `joolry-v1` |
| `deploy.yml` | GitHub Actions Pages deploy |
| `joolryLogo.png` | Logo asset |
| `icon-*.png` | PWA icons (replace with Joolry icons later) |

---

## Updated Constants

### Sheet IDs (Code.gs)
```
MASTER_SHEET_ID        = 1Di0EIuJfqU8EyNh7RQwyKAZB8_-0XFk3jheKXfGfoHo
CHECKLIST_MASTER_ID    = 1pWacPSDUFb0CShHrMsltoRG1HQUGFfk2TO-PMs3ZNEo
NEW_ATTENDANCE_SHEET_ID = 1zcl1mX6wXzOQxmkTlhwl0Fo4W7F7PJffZkXhNZCaD28
```

### WhatsApp
```
WA_API_KEY    = 01de01ec7d489783060e2fdc535a87ca5e963b7baba7e95ff3
WA_BASIC_AUTH = am9vbHJ5Okpvb2xyeUBAMjAyNg==   // Joolry:Joolry@@2026
```

### Session
```
SESSION_KEY = joolry_session_v1
```

---

## Step 1 — Apps Script (Code.gs)

1. Open script.google.com → create **new** project (or clone Fresko project)
2. Paste full `Code.gs` from artifacts
3. Save
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the Web App URL
6. Paste into `appconfig.js` → `GAS_URL`

---

## Step 2 — GitHub Pages

```bash
# Clone empty repo
git clone https://github.com/joolry/dailyapp.git
cd dailyapp

# Copy all frontend files
cp /path/to/artifacts/index.html .
cp /path/to/artifacts/app.js .
cp /path/to/artifacts/appconfig.js .
cp /path/to/artifacts/manifest.json .
cp /path/to/artifacts/sw.js .
cp /path/to/artifacts/deploy.yml .github/workflows/deploy.yml
cp /path/to/artifacts/joolryLogo.png .
cp /path/to/artifacts/icon-*.png .

git add .
git commit -m "v1.0: Joolry Daily — full portal rebrand"
git push origin main
```

Enable GitHub Pages: Settings → Pages → Source = GitHub Actions

---

## Step 3 — AppConfig sheet (MASTER)

Ensure these keys exist (or defaults work):

| Key | Suggested Value |
|-----|-----------------|
| COMPANY_NAME | Joolry |
| MASTER_PASSWORD | joolry@2026 |
| TIMEZONE | Asia/Kolkata |
| WORK_START_TIME | 10:00 |
| SESSION_HOURS | 12 |

---

## Theme Tokens

| Token | Value | Use |
|-------|-------|-----|
| `--P` | `#111111` | Primary (black) |
| `--Pd` | `#2A2A2A` | Primary dark |
| `--bg` | `#F8F6F3` | Cream background |
| `--T` / `--A` | `#B76E79` / `#E8B4B8` | Soft coral accent |
| Logo | joolry.in CDN | Official black wordmark |

---

*Joolry Daily v1.0 — Oct 2026*
