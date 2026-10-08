# Joolry — Fresko-style Snapshot (Final Speed)

Reads for hot screens come from **one global Firestore snapshot** (like Fresko).  
Writes still go to **Apps Script**; after each write the snapshot rebuilds in the background.

---

## 1. Apps Script (Code.gs)

### A. Register `getSnapshot` in `_callFn`

Inside the `fns` object in `_callFn`, add:

```javascript
'getSnapshot': function (a) { return getSnapshot(); },
```

### B. Paste function

Copy the entire contents of `GAS_getSnapshot.gs` into the bottom of your Code.gs (or a new script file in the same project).

### C. Deploy

- Deploy → **Manage deployments** → **New version** of the existing Web App  
- Execute as: **Me**  
- Who has access: **Anyone**

### D. Sheet-edit trigger (optional but recommended)

You already have `_notifyVercelSync` / `onAnySheetEdit`. Ensure `VERCEL_SYNC_URL` and `SYNC_SECRET` are in Script Properties:

| Property        | Value                                      |
|-----------------|--------------------------------------------|
| VERCEL_SYNC_URL | `https://joolrytaskapp.vercel.app/api/sync` |
| SYNC_SECRET     | same as Vercel `SYNC_SECRET`               |

Then run once from editor: `setupVercelTriggers()`

Also add a **time-driven** safety trigger (every 5–10 min) that calls a small function:

```javascript
function scheduledSnapshotBump() {
  _notifyVercelSync();
}
```

Or hit the sync URL with secret from a time trigger via UrlFetchApp.

---

## 2. Vercel repo (`api/`)

Replace / add these files from `artifacts/api/`:

| File           | Action                                      |
|----------------|---------------------------------------------|
| `_store.js`    | **NEW** — global snapshot storage           |
| `_snapServe.js`| **NEW** — filter snapshot per user/read     |
| `_lib.js`      | **REPLACE** — snapshot → cache → GAS        |
| `_cache.js`    | **REPLACE** — secondary cache + STALE       |
| `rpc.js`       | **REPLACE** — same headers, SNAP support    |
| `sync.js`      | **REPLACE** — full rebuild + bump           |

No `package.json` change needed (`firebase-admin` + `@vercel/functions` already there).

### Env (confirm)

| Key                      | Value        |
|--------------------------|--------------|
| `SNAPSHOT`               | **`on`**     |
| `FIREBASE_SERVICE_ACCOUNT` | full JSON or base64 |
| `GAS_URL`                | Web App URL  |
| `GAS_SECRET`             | same as GAS `API_SECRET` |
| `SESSION_SECRET`         | long random  |
| `SYNC_SECRET`            | long random  |

Commit + push → Vercel auto-deploys.

---

## 3. First warm-up (important)

After deploy, **once**:

```
https://joolrytaskapp.vercel.app/api/sync?secret=YOUR_SYNC_SECRET&full=1
```

Or open the app, login once — `_lib` kicks `runSync()` after login.

Wait ~30–60s for first `getSnapshot` + Firestore write.

---

## 4. How to verify speed

1. Login → open Dashboard / Tasks / Attendance  
2. F12 → Network → `/api/rpc`  
3. Response headers:

| `X-Cache` | Meaning                                      |
|-----------|----------------------------------------------|
| **SNAP**  | Global snapshot (fastest, target)            |
| HIT       | Per-fn cache                                 |
| STALE     | Old cache, refresh in background             |
| MISS      | Live GAS (slow)                              |
| OFF       | `SNAPSHOT` not `on`                          |

`X-GAS-MS` should be **0** on SNAP/HIT.

---

## 5. What is served from snapshot

- `getBootData`, `getAllData`
- `getDashboardStats`, `getDashboardStatsFresh`
- `getTodayAttendanceStatus`, `getTodayTasks`
- `getMyDelegations`, `getAnnouncements`
- `getAllAppConfigForFrontend`, `getHolidayList`, `getDoerList`
- `getTeamAttendanceStatus`, `getTeamChecklistToday`

Everything else (analytics, payroll, leave approve, check-in/out writes, etc.) still uses per-fn cache or live GAS.

---

## 6. Rollback

Set `SNAPSHOT=off` on Vercel → all reads go live GAS again (old behaviour).  
No need to remove GAS `getSnapshot`.

---

## Flow (final)

```
READ (hot):  Browser → Vercel → Firestore SNAP → (filter by user) → UI
READ (other): Browser → Vercel → per-fn cache → else GAS
WRITE:       Browser → Vercel → GAS → sheets → dirty → background getSnapshot → Firestore
```
