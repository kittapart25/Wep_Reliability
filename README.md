# RelTest Lab

Reliability Test scheduling system, split into a **backend** (Node.js/Express API) and a
**frontend** (plain HTML/CSS/JS, no build step).

```
reltest-lab/
├─ backend/
│  ├─ server.js                 entry point (Express app, serves the frontend too)
│  ├─ package.json
│  └─ src/
│     ├─ config.js              port, paths, upload limits, session TTL
│     ├─ store.js               JSON-file document store (swap for a real DB later)
│     ├─ auth.js                scrypt password hashing, sessions, requireAuth/requireAdmin
│     ├─ seed.js                default accounts + chambers on first run
│     └─ routes/
│        ├─ auth.routes.js      login / me / logout / change-password
│        ├─ data.routes.js      generic document API + live updates (SSE) + permissions
│        └─ upload.routes.js    invoice upload (admin only)
└─ frontend/
   ├─ index.html
   ├─ css/styles.css
   └─ js/
      ├─ config.js              API_BASE setting
      ├─ api.js                 API client (fetch + EventSource), Firestore-style `Api.db`
      └─ app.js                 all UI logic and pages
```

## Run

```bash
cd backend
npm install
npm start          # or: npm run dev  (auto-restart)
```

Open http://localhost:3000

Default accounts (password = last 4 digits of employee ID):

| Role      | Employee ID | Password |
|-----------|-------------|----------|
| Admin     | 000001      | 0001     |
| Requester | 200001      | 0001     |

Change them in **Settings** after the first login.

### Running the frontend from VS Code Live Server
Edit `frontend/js/config.js`:

```js
window.RELTEST_CONFIG = { API_BASE: 'http://localhost:3000' };
```

(The backend already allows cross-origin requests.)

## Backend API

All routes except login/health need `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/auth/login | `{empId, password}` -> `{token, user}` |
| GET | /api/auth/me | current user |
| POST | /api/auth/logout | |
| POST | /api/auth/change-password | `{currentPassword, newPassword}` |
| GET/POST | /api/data/:collection | list / add |
| GET/PUT/PATCH/DELETE | /api/data/:collection/:id | get / set / merge-update / delete |
| GET | /api/data/chambers/:id/repairs | sub-collection (same pattern) |
| GET | /api/stream/:collection?token= | live snapshots (Server-Sent Events) |
| POST | /api/upload?filename=x.pdf | raw body, admin only -> `{id, url}` |
| GET | /api/health | |

Collections: `employees`, `requests`, `chambers`, `chambers/{id}/repairs`.

Permissions: Admin can do everything. Requester can create requests and edit
their own; everything else is read-only. Passwords are stored as scrypt
hashes and never sent to the browser.

## Where to go next
- **Real database:** only `backend/src/store.js` touches storage. Re-implement
  its functions (`list/get/set/add/update/remove`) on PostgreSQL/MongoDB.
- **Live temperatures:** the Dashboard values are simulated in `startTempSim()`
  in `frontend/js/app.js`. Replace with real readings (e.g. a `/api/temps` route).
- **Production:** run behind HTTPS, set a proper CORS origin in `server.js`,
  and consider moving sessions to a persistent store.
"# Wep_Reliability" 
