# Deployment

## Runtime requirements

- Node.js **≥ 22** (see `.nvmrc`)
- npm workspaces
- MongoDB with **transaction support** (Atlas or replica set)
- Process manager or container host for the API (`backend`)
- Static hosting or reverse proxy for the Vite SPA (`frontend` build)

## Environment configuration

Copy examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### Backend (required)

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` in live |
| `PORT` | API port (default 4000) |
| `APP_URL` | Public SPA origin |
| `CORS_ORIGINS` | Comma-separated allowed origins (must include SPA) |
| `MONGODB_URI` | Mongo connection string |
| `JWT_ACCESS_SECRET` | ≥32 char secret for staff + portal access JWTs |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh lifetime |
| `WEBSITE_LEAD_INTAKE_SECRET` | Public intake header secret |
| `FILE_STORAGE_DIR` | Local file root until S3/R2 configured |
| `FILE_MAX_BYTES` | Upload cap |

### Frontend

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Absolute API base, e.g. `https://api.example.com/api/v1` |

## Database

1. Provision MongoDB with replica set / Atlas.
2. Run seed for configuration only (no fake business data):

```bash
npm run seed -w backend
```

Seed prompts for the first Admin email/name/temporary password (`mustChangePassword: true`).

## Storage

- Default local disk under `FILE_STORAGE_DIR`.
- Ensure the directory is persistent across deploys or migrate to S3/R2 when credentials exist.
- Back up storage alongside MongoDB dumps.

## Email / SMS / integrations

Leave unset until providers are approved. Adapters remain `not_configured`. See [INTEGRATIONS.md](./INTEGRATIONS.md).

## Build

```bash
npm install
npm run build
```

Produces backend `dist/` and frontend `dist/`.

## Run (production-like)

```bash
# API
npm run start -w backend

# SPA: serve frontend/dist behind nginx/CDN; point VITE_API_URL at the API at build time
```

## Deployment procedure (checklist)

1. Set secrets in the host environment (never commit `.env`).
2. Ensure MongoDB reachable and indexes created via app models on first boot.
3. `npm ci` → `npm run build`.
4. Run DB seed once for empty environments.
5. Start API; verify `GET /health`.
6. Deploy SPA; verify login + CORS.
7. Force Admin password change on first login.
8. Confirm refresh cookies work on HTTPS (`secure` cookie flag when `NODE_ENV=production`).

## Backup and recovery

- Schedule MongoDB backups (Atlas continuous or `mongodump`).
- Back up `FILE_STORAGE_DIR` if local storage is used.
- Document RTO/RPO with the client before production cutover (open operational decision).

## Production security checklist

- [ ] Strong unique `JWT_ACCESS_SECRET` and intake secret
- [ ] HTTPS only; HSTS via reverse proxy
- [ ] CORS origins locked to real SPA URL(s)
- [ ] Refresh cookies `Secure` + `HttpOnly` + `SameSite=Lax`
- [ ] Rate limits retained on auth endpoints
- [ ] No plaintext passwords logged
- [ ] Forced password change enabled for temp passwords
- [ ] Portal JWT audience separate from staff
- [ ] File visibility enforced for portal
- [ ] Integration credentials absent or vaulted — no fake “connected” UI
- [ ] Admin accounts deactivated when staff leave (revokes sessions)

## Additions (2026-11-06)
- **Never run the demo seed/reset in production.** Both scripts refuse `NODE_ENV=production`; do not set `DEMO_ALLOW_REMOTE_SEED` / `DEMO_ALLOW_REMOTE_RESET` outside a throwaway database.
- `AUTH_RATE_LIMIT_MAX` is a local-development convenience and is **ignored in production** (limit stays 10 failed attempts / 15 min). Do not set it on servers.
- **Database:** replica set or Atlas is mandatory (transactions). A standalone mongod will fail on lead conversion.
- **File storage:** the local-disk adapter is development only. Production needs persistent object storage (S3/R2), server-side encryption, versioning and a tested backup/restore plan before real customer photos or documents are stored. Files are only reachable through authenticated API routes; storage paths are never returned to clients.
- **Brand assets:** the logo variants live in `frontend/public/brand/`; the printable documents embed a resized copy from `backend/src/assets/brand-logo.ts`. Regenerate both if the official logo changes.
- **Time zone:** schedules are entered and shown in company time (`America/Chicago`, from company settings).
- **Frontend sessions:** keep the single-flight session bootstrap (`modules/auth/api.ts`); refresh tokens rotate and reuse revokes the whole session family.
