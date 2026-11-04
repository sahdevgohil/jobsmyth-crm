# Phase 1 — Foundation Delivery Report

| Field | Value |
|---|---|
| Project | Legacy Roofing CRM |
| Client | Legacy Construction Group |
| Phase | 1 — Foundation |
| Report date | 2026-11-04 |
| Related | [PRD.md](./PRD.md) · [PROJECT.md](./PROJECT.md) · [DECISIONS.md](./DECISIONS.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) |

---

## 1. Executive summary

Phase 1 Foundation is **implemented in code** and verified locally (`lint`, `typecheck`, `test`, `build` green). An Admin can be seeded, sign in, create a salesperson, and that salesperson can sign in with restricted access.

**Exit criteria status**

| Criterion | Status |
|---|---|
| Admin signs in | Met (after `npm run seed`) |
| Admin creates salesperson | Met |
| Salesperson signs in with restricted access | Met (tested: `403` on admin-only routes) |
| CI green (lint / typecheck / test / build) | Met locally; GitHub Actions workflow added |
| Deployed to staging | **Not met** — blocked on hosting decision (Q-027 / D-029) |

No Phase 2+ business modules (leads, customers, appointments, etc.) were implemented or scaffolded.

---

## 2. Requirement coverage

### 2.1 Authentication and users (AUTH-001–AUTH-014)

| ID | Requirement (short) | Status | Notes |
|---|---|---|---|
| AUTH-001 | Sign in / sign out; logout revokes refresh | Done | |
| AUTH-002 | Argon2id password hashing | Done | |
| AUTH-003 | JWT access + rotating httpOnly refresh cookie | Done | Atomic claim rotation (V-01); path `/api/v1/auth` |
| AUTH-004 | Roles `admin` / `salesperson`; central permission map | Done | `config/permissions.ts` |
| AUTH-005 | Admin create / edit / deactivate users | Partial | API create/edit/deactivate; **UI create + deactivate only** (no edit form yet) |
| AUTH-006 | Deactivate / role change revokes sessions | Done | Deactivate covered by tests; role change via service |
| AUTH-007 | Temp password; must change at first sign-in | Done | SPA gate **and** backend `requirePasswordChanged` (V-02) |
| AUTH-008 | Reset / invite tokens (hashed, expiring) | Partial | Token APIs + accept/reset; invite accept revokes sessions (V-04); **email delivery disabled** until INT-03 |
| AUTH-009 | Password 12–128 chars | Done | |
| AUTH-010 | Auth endpoints rate-limited | Done | Login skip-success limiter; forgot/reset/invite use **strict** limiter (V-03) |
| AUTH-011 | Frontend redirects unauthenticated users | Done | Restores intended route; FE unit test |

| AUTH-012 | API auth + permission checks | Done | |
| AUTH-013 | `GET /auth/me` with permissions | Done | |
| AUTH-014 | Change own password; revoke other sessions | Done | |

**Acceptance criteria**

| AC | Result |
|---|---|
| AC-AUTH-1 Deactivated user cannot login; refresh fails | Pass (automated) |
| AC-AUTH-2 Salesperson → admin endpoint `403` | Pass (automated) |
| AC-AUTH-3 Refresh token reuse revokes family | Pass (automated) — sequential + concurrent V-01 |
| AC-AUTH-4 No `passwordHash` in responses; Argon2id stored | Pass (automated) — asserts `/^\$argon2id\$/` |
| AC-AUTH-5 Ten failed logins → `429` | Pass (automated) |

### 2.2 Settings skeleton (SET-001–SET-003)

| ID | Status | Notes |
|---|---|---|
| SET-001 Company settings | Done | GET/PATCH `/settings/company` |
| SET-002 Configurable lookups | Done | Admin CRUD by type |
| SET-003 Deactivate lookups (no delete) | Done | |
| SET-004 Templates | **Out of phase** | Deferred |

Seed loads default lookup values and lead pipeline stages as **configuration only** (no Admin pipeline-stage UI — that stays with Phase 2 / LEAD-006).

### 2.3 Audit (AUD-001, AUD-004)

| ID | Status | Notes |
|---|---|---|
| AUD-001 Immutable audit entries | Done | API read-only + Mongoose hooks reject update/delete |
| AUD-004 Admin list / filter | Partial | API list + filters; **UI list page 1 only** (no filter controls) |
| AUD-002 (subset) | Done for Phase 1 actions | User/role changes, login failures, settings changes |

### 2.4 Security / NFR (Phase 1 slice)

| ID | Status |
|---|---|
| SEC-002–007, SEC-009, SEC-013 | Done (auth, Zod, CORS allow-list, Helmet, rate limits, env secrets) |
| NFR-007 Structured logs (pino) | Done — Authorization/cookie headers redacted (V-05); Sentry not installed |
| NFR-009 CI quality gates | **Workflow present; CI not verified** — requires GitHub remote + successful Actions run (V-06) |

---

## 3. What was built

### Repository

- npm workspaces: `frontend`, `backend`
- Node 22 (`.nvmrc`), TypeScript strict, ESLint, Prettier
- GitHub Actions: lint → typecheck → test → build

### Backend (`/api/v1`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/refresh`, `/logout`, `GET /me`, `POST /password/change`, `/password/forgot`, `/password/reset`, `/invites/accept` |
| Users | `GET/POST /users`, `GET/PATCH /users/:id`, `POST /users/:id/deactivate` |
| Settings | `GET/PATCH /settings/company`, `GET/POST /settings/lookups/:type`, `PATCH /settings/lookups/:type/:id` |
| Audit | `GET /audit-logs` |
| Health | `GET /health` |

Collections used: `users`, `refreshSessions`, `authTokens`, `companySettings`, `lookupValues`, `auditLogs` (+ seeded `pipelineStages` config).

### Frontend

- Vite + React + Tailwind + shadcn-style UI
- Routes: `/login`, `/reset-password`, `/accept-invite`, `/app/*`
- Pages: Home, Users (Admin), Company Settings, Lookups, Audit Log, Change Password
- Access token in memory; refresh via httpOnly cookie

### Explicitly not built (by design)

Leads, customers, dashboard tiles, appointments, projects, estimates, invoices, portal, Redis/BullMQ/`worker.ts`, Playwright PDF, Sentry, integration SDKs, CSV import (MIG).

---

## 4. Test evidence

| Suite | Result |
|---|---|
| Backend Vitest + Supertest | **25 passed** (auth incl. V-01–V-04, users, settings, audit, logging) |
| Frontend Vitest | **6 passed** (smoke, permissions, RequireAuth) |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |

---

## 5. How to run (local)

```bash
cd legacy-roofing-crm
npm install
# Ensure MongoDB is running (URI in backend/.env)
cp backend/.env.example backend/.env   # if needed
cp frontend/.env.example frontend/.env
npm run seed          # prompts for Admin email + temporary password
npm run dev           # or: npm run dev:backend / npm run dev:frontend
```

Sign in at `http://localhost:5173/login` with the Admin credentials you entered during seed. There are **no hardcoded default credentials**.

---

## 6. Open items and blockers

| Item | Impact | Owner |
|---|---|---|
| **Q-027 / D-029** Hosting vendors for API + frontend | Blocks Phase 1 exit “deployed to staging” | Client + developer |
| **Q-020 / INT-03** Resend / verified email domain | AUTH-008 invite/reset email send disabled | Client DNS + validation track |
| **Q-001** Final user count confirmation | Seed / seat planning only | Client |
| **Q-021** CSV import approval | Phase 2 planning only — not implemented | Client |
| MongoDB Atlas (or local replica set) for staging | Required for staging DB | Client + developer |

Working defaults used in code are recorded as **D-033** in [DECISIONS.md](./DECISIONS.md).

---

## 7. Client demo checklist (staging once available)

1. Seed Admin → sign in → forced password change.
2. Create salesperson with temporary password.
3. Sign in as salesperson → Users / Audit / Lookups admin actions hidden or blocked.
4. Salesperson calling `GET /api/v1/users` returns `403`.
5. Admin updates company settings and a lookup; entries appear in Audit log.
6. Deactivate salesperson → cannot sign in; existing refresh fails.

---

## 8. Recommendation

- Treat Phase 1 **code delivery as complete** for local/CI review.
- Close **Q-027** to enable staging deploy and formal M1 sign-off.
- Start Validation Track answers needed before Phase 2 (especially Q-002, Q-003, Q-006, Q-021).
- Do **not** start Phase 2 until this phase’s staging review is confirmed per PROJECT.md §7.

---

## 9. Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Developer | | 2026-11-04 | Phase 1 code ready for client review (staging pending) |
| Client | | | Pending staging review |
