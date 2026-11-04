# Phase 1 — Independent Verification & Hardening Review

| Field | Value |
|---|---|
| Project | Legacy Roofing CRM |
| Scope | Phase 1 Foundation only (no Phase 2) |
| Review date | 2026-11-05 |
| Method | Read-only codebase review vs PRD, ARCHITECTURE, TECH_STACK, CURSOR_RULES, DECISIONS, PHASE1_REPORT |
| Code modified | **No** |

---

## Verdict

Phase 1 is a **solid foundation skeleton** with correct layering, route-level authorization, Argon2id, hashed rotating refresh tokens (sequential path), and working Admin → salesperson restricted-access flows.

It is **not staging-ready** until critical hardening items below are fixed, Git is initialized with a remote so CI can actually run, and staging hosting (Q-027) is chosen.

**CI status:** Cannot be claimed green. There is **no `.git` repository** under `legacy-roofing-crm` or the parent workspace, `gh` is unavailable, and no GitHub Actions run history exists. Only a workflow *file* is present ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). Local `lint` / `typecheck` / `test` / `build` success is **not** CI green.

---

## 1. Verified items (working as designed)

### Authentication

| Item | Evidence |
|---|---|
| Argon2id hashing | `createPasswordHash` / `verifyPassword` in [`auth.service.ts`](../backend/src/modules/auth/auth.service.ts) use `argon2.argon2id` |
| Opaque refresh + SHA-256 storage | `generateOpaqueToken` + `hashToken`; unique index on `tokenHash` in [`refresh-session.model.ts`](../backend/src/modules/auth/refresh-session.model.ts) |
| Sequential refresh reuse → family revoke | `refresh()` when `session.revokedAt` set → `updateMany` by `familyId` → `SESSION_REVOKED` ([`auth.service.ts`](../backend/src/modules/auth/auth.service.ts) ~168–177); tested in [`auth.routes.test.ts`](../backend/src/modules/auth/auth.routes.test.ts) |
| Cookie flags | `httpOnly`, `sameSite: 'lax'`, `path: '/api/v1/auth'`, `secure` in production — `cookieOptions()` in [`auth.controller.ts`](../backend/src/modules/auth/auth.controller.ts) |
| CORS credentials + allow-list | [`app.ts`](../backend/src/app.ts) `cors({ origin: getCorsOrigins(), credentials: true })` |
| Helmet | [`app.ts`](../backend/src/app.ts) |
| Logout revokes current refresh | `logout()` sets `revokedAt` ([`auth.service.ts`](../backend/src/modules/auth/auth.service.ts) ~222–234) |
| Password change revokes other sessions | `changePassword()` with optional keep-current hash ([`auth.service.ts`](../backend/src/modules/auth/auth.service.ts)) |
| Deactivate / role change / temp password → revoke all sessions | [`user.service.ts`](../backend/src/modules/users/user.service.ts) `updateUser` / `deactivateUser` |
| Inactive user rejected on login, refresh, authenticate | `login`, `refresh`, `authenticate` all check `isActive` |
| Access token short-lived JWT `aud=internal` | [`jwt.ts`](../backend/src/modules/auth/jwt.ts) 15m HS256 |
| Reset/invite tokens hashed, expiring (1h / 72h), purpose enum | [`auth-token.model.ts`](../backend/src/modules/auth/auth-token.model.ts), `createPasswordResetToken` / `createInviteToken` |
| Forgot-password public response does not reveal existence | [`auth.controller.ts`](../backend/src/modules/auth/auth.controller.ts) `forgotPassword` always 200 with same message shape |
| Login rate limit → 429 after failed attempts | `authRateLimiter` + AC-AUTH-5 test; `skipSuccessfulRequests: true` is appropriate **for login** |
| DTOs omit `passwordHash` | [`user.mapper.ts`](../backend/src/modules/users/user.mapper.ts) |
| Env fail-fast | [`config/env.ts`](../backend/src/config/env.ts); scripts use `--env-file=.env` |

### Authorization

| Item | Evidence |
|---|---|
| Users routes: `authenticate` + `authorize('users:manage')` on all | [`user.routes.ts`](../backend/src/modules/users/user.routes.ts) |
| Settings: authenticate + read/update permissions | [`settings.routes.ts`](../backend/src/modules/settings/settings.routes.ts) |
| Audit: authenticate + `audit:read` only GET | [`audit.routes.ts`](../backend/src/modules/audit/audit.routes.ts) |
| Salesperson → admin API returns 403 | Tested; `authorize` in [`authorize.ts`](../backend/src/middleware/authorize.js) |
| Frontend permissions are UI-only | [`RequirePermission.tsx`](../frontend/src/app/RequirePermission.tsx), [`useHasPermission`](../frontend/src/lib/permissions.ts); matches PRD §5 / CURSOR_RULES §7 |
| Central permission map | [`config/permissions.ts`](../backend/src/config/permissions.ts) |

### Audit

| Item | Evidence |
|---|---|
| No PATCH/DELETE audit APIs | Only `GET /` in [`audit.routes.ts`](../backend/src/modules/audit/audit.routes.ts) |
| Writes via `recordAudit` | [`services/audit.ts`](../backend/src/services/audit.ts) |
| Phase 1 actions audited | login fail/success, logout, password change/reset, invite accept, user create/update/deactivate, settings/lookup changes |

### Frontend (behavioral)

| Item | Evidence |
|---|---|
| Login + redirect / forced change | [`LoginPage.tsx`](../frontend/src/pages/LoginPage.tsx) |
| `RequireAuth` unauthenticated → `/login` with `from` | [`RequireAuth.tsx`](../frontend/src/app/RequireAuth.tsx) |
| Forced password change gate (SPA) | `RequireAuth` lines 22–24 |
| Session bootstrap via refresh + `/me` | [`SessionBootstrap.tsx`](../frontend/src/app/SessionBootstrap.tsx) |
| 401 → single-flight refresh; fail clears session | [`http.ts`](../frontend/src/services/http.ts) |
| Admin nav gated; salesperson Settings view-only | [`AppLayout.tsx`](../frontend/src/layouts/AppLayout.tsx), [`SettingsPage.tsx`](../frontend/src/pages/SettingsPage.tsx) |
| Loading / empty / error panels on Users, Lookups, Audit | shared [`StatePanel.tsx`](../frontend/src/components/shared/StatePanel.tsx) |

### Data model

| Item | Evidence |
|---|---|
| Unique email, unique token hashes | user / refreshSession / authToken models |
| Zod validation on bodies/params/query | `validate` middleware + module `*.validation.ts` |
| Central `AppError` + safe error envelope | [`error-handler.ts`](../backend/src/middleware/error-handler.ts) |

### Explicit non-goals correctly absent

No leads/customers/portal, no Redis/BullMQ/`worker.ts`, no Sentry, no CSV import, no third-party SDKs — matches PROJECT §7 / TECH_STACK §14 / D-031.

---

## 2. Bugs and security issues

### Critical / High — fix before staging

| ID | Severity | Issue | Evidence | Why it matters |
|---|---|---|---|---|
| V-01 | **High** | Refresh rotation is not atomic | `refresh()` in [`auth.service.ts`](../backend/src/modules/auth/auth.service.ts) ~158–212: `findOne` → `create` new → then `save` revoke old. No `findOneAndUpdate` claim / transaction | Concurrent `/refresh` can fork a valid family; AC-AUTH-3 only proves sequential reuse |
| V-02 | **High** | `mustChangePassword` is SPA-only (AUTH-007 incomplete) | [`authenticate.ts`](../backend/src/middleware/authenticate.ts) attaches flag but never blocks; gate only in [`RequireAuth.tsx`](../frontend/src/app/RequireAuth.tsx) 22–24 | Temp-password users can call any permitted API with Bearer token; violates SEC-004 “backend is the control” |
| V-03 | **High** | Forgot-password rate limit ineffective | [`rate-limit.ts`](../backend/src/middleware/rate-limit.ts) `skipSuccessfulRequests: true`; [`forgotPassword`](../backend/src/modules/auth/auth.controller.ts) always returns 200 | Unlimited reset-token creation / probing; AUTH-010 / SEC-006 overstated |
| V-04 | **High** | `acceptInvite` does not revoke refresh sessions | [`acceptInvite`](../backend/src/modules/auth/auth.service.ts) ~392–423 vs `resetPasswordWithToken` which calls `revokeAllUserSessions` at 367 | Sessions from temp-password login survive invite acceptance |
| V-05 | **High** | Access/refresh tokens can be logged | [`app.ts`](../backend/src/app.ts) `pinoHttp` with no `redact`; default serializers include `authorization` / `cookie` headers | Conflicts with CURSOR_RULES §13 / NFR-010 spirit |
| V-06 | **High** (process) | No git remote / no CI runs | No `.git` in project tree; workflow file unused | Cannot claim NFR-009 / exit “CI green” |

### Medium

| ID | Severity | Issue | Evidence |
|---|---|---|---|
| V-07 | Medium | Refresh Origin check allows missing `Origin` | `assertRefreshOrigin` in [`auth.controller.ts`](../backend/src/modules/auth/auth.controller.ts) 44–48 returns early if no Origin — weaker than ARCHITECTURE §7 wording |
| V-08 | Medium | Reset/invite single-use is check-then-set (race) | `findOne` → mutate → `usedAt` save in `resetPasswordWithToken` / `acceptInvite` |
| V-09 | Medium | Multiple live reset/invite tokens per user | `createPasswordResetToken` / `createInviteToken` always insert; priors remain valid until TTL |
| V-10 | Medium | TTL on `expiresAt` may delete revoked refresh rows used for reuse detection | [`refresh-session.model.ts`](../backend/src/modules/auth/refresh-session.model.ts) TTL index |
| V-11 | Medium | Login timing / audit side-channel for email enumeration | Unknown users fail before Argon2; known users verify hash ([`login`](../backend/src/modules/auth/auth.service.ts) ~84–110) |
| V-12 | Medium | AUTH-005 / AUD-004 UI incomplete vs “Done” | Backend `PATCH /users/:id` exists; frontend has create+deactivate only ([`users/api.ts`](../frontend/src/modules/users/api.ts)). Audit API filters exist; UI hardcodes page 1 ([`AuditPage.tsx`](../frontend/src/pages/AuditPage.tsx)) |

### Low / Info

| ID | Severity | Issue | Evidence |
|---|---|---|---|
| V-13 | Low | `GET /auth/me` has `authenticate` but no `authorize` | [`auth.routes.ts`](../backend/src/modules/auth/auth.routes.ts) — intentional exception; document or add `auth:me` |
| V-14 | Low | Audit immutability is API-only, not DB-enforced | No Mongoose pre-hooks rejecting updates/deletes |
| V-15 | Low | Weak mutation error UX on Lookups create / Users deactivate | Frontend pages |
| V-16 | Info | No Phase 1 multi-doc transactions used | `recordAudit` accepts `session` but callers never pass it; staging needs replica set before txn fixes for V-01/V-08 |
| V-17 | Info | Missing `familyId` index on refresh sessions | Revoke-by-family `updateMany` will scan |

---

## 3. Missing tests

### Backend (critical gaps)

| Missing | Requirement / AC |
|---|---|
| Concurrent refresh race / atomic claim | AC-AUTH-3 hardening (V-01) |
| Backend rejects non-password-change routes when `mustChangePassword` | AUTH-007 / SEC-004 (V-02) |
| Forgot-password rate limit (all requests counted) | AUTH-010 (V-03) |
| Logout revokes refresh (cookie then refresh → 401) | AUTH-001 |
| `GET /auth/me` shape + permissions | AUTH-013 |
| Role-change / temp-password update revokes sessions | AUTH-006 (only deactivate tested) |
| Audit `GET` admin OK / salesperson 403 + query filters | AUD-004 (**no audit test file**) |
| Argon2id **hash prefix** assertion (`$argon2id$`) | AC-AUTH-4 (report overstates: tests only exclude `passwordHash` from JSON) |
| Reset + invite accept happy path + reuse of spent token | AUTH-008 |
| `acceptInvite` revokes sessions | V-04 |
| User `PATCH` + salesperson forbidden | AUTH-005 |

### Frontend (critical gaps)

| Missing | Notes |
|---|---|
| Entire suite is smoke-only | [`frontend/src/smoke.test.ts`](../frontend/src/smoke.test.ts) — `expect(true).toBe(true)` |
| AUTH-011 redirect + restore `from` | Report marks Done; zero FE tests |
| Forced password-change gate | Manual only |
| Admin vs salesperson nav / `RequirePermission` | Manual only |
| SessionBootstrap + refresh failure clears session | Untested |
| Loading/empty/error states | Untested |

**Count check:** Backend 15 tests (10 auth + 2 users + 3 settings) matches PHASE1_REPORT. Frontend 1 smoke test matches report honesty — but is insufficient for Phase 1 exit confidence.

---

## 4. Documentation discrepancies

| Claim (PHASE1_REPORT / docs) | Reality |
|---|---|
| AUTH-007 **Done** | Incomplete — SPA-only enforcement (V-02) |
| AUTH-010 **Done** / SEC-006 covered | Login OK; forgot/reset **not** effectively limited (V-03) |
| AC-AUTH-3 **Pass (automated)** | Sequential pass only; concurrent race untested/unfixed (V-01) |
| AC-AUTH-4 **Pass (automated)** | No Argon2id format assertion in DB |
| AUTH-005 **Done** (create/edit/deactivate) | Backend edit yes; **frontend edit missing** (V-12) |
| AUD-004 **Done** (list/filter) | API filters yes; **UI no filters/pagination** (V-12) |
| AUTH-006 “Covered by tests” | Deactivate covered; **role change not** |
| NFR-007 structured logs Done | No PII/token redaction (V-05) |
| NFR-009 / “CI green” in exit table as Met locally | Workflow exists; **CI never executed** (V-06); no git repo |
| AUTH-008 Partial (email off) | Correct on email; understates invite session revoke + token races |
| Staging blocked on Q-027 | Still accurate and still open |
| D-033 Phase 1 landed with working defaults | Accurate for stack choices |

ARCHITECTURE §7 refresh Origin check is stronger than implementation (missing Origin allowed).

CURSOR_RULES §8 “every private route has authenticate **and** authorize” — `/auth/me` exception undocumented.

---

## 5. Critical fixes required before staging

1. **V-01** Atomic refresh rotation (claim-then-issue; prefer transaction on replica set).
2. **V-02** Backend middleware: if `mustChangePassword`, allow only password change / me / logout.
3. **V-03** Separate auth limiter for forgot/reset/invite that counts successful responses.
4. **V-04** `acceptInvite` → `revokeAllUserSessions` (+ invalidate sibling tokens).
5. **V-05** pino-http `redact` for `authorization` / `cookie` / `set-cookie`.
6. **V-06** `git init` + remote + push so Actions runs; do not claim CI green until a green run exists.
7. **Replica set** Mongo for staging (transactions + Atlas per PROJECT/TECH_STACK).
8. **Q-027 / D-029** Hosting decision — still blocks exit criterion “deployed to staging”.
9. Add automated tests for V-01–V-04, logout, `/me`, audit 403, Argon2id prefix, and minimal FE auth guards.

Do **not** start Phase 2 until these are addressed and client reviews staging (PROJECT.md §7).

---

## 6. Non-critical improvements (can wait)

- V-07 Strengthen Origin / Sec-Fetch-Site on refresh (and logout if desired).
- V-08 / V-09 Atomic token consume; invalidate prior reset/invite tokens on create.
- V-10 Separate TTL/`purgeAt` for reuse-detection retention; index `familyId`.
- V-11 Constant-time login path (dummy Argon2 verify).
- V-12 Frontend user edit UI + audit filters/pagination (or mark report Partial).
- V-13 Document `/me` authorize exception or add permission.
- V-14 DB-level audit immutability hooks / Mongo role lockdown.
- V-15 Mutation error toasts on Lookups/Users.
- Broader frontend Vitest (router/guards) — Playwright E2E remains Phase 2 per TECH_STACK §14.
- Correct PHASE1_REPORT statuses after fixes (AUTH-007, AUTH-010, AC-AUTH-3/4, AUTH-005, AUD-004, CI).

---

## 7. Requirement status corrections (recommended)

| ID | Report status | Recommended status |
|---|---|---|
| AUTH-007 | Done | **Partial** — temp password set; forced change not backend-enforced |
| AUTH-010 | Done | **Partial** — login limited; forgot always 200 bypasses limiter |
| AUTH-005 | Done | **Partial** — API complete; Admin UI missing edit |
| AUD-004 | Done | **Partial** — API filters; UI list-only |
| AC-AUTH-3 | Pass | **Pass (sequential only)** — note concurrency gap |
| AC-AUTH-4 | Pass | **Partial** — no Argon2id format assert |
| CI / NFR-009 | Met locally | **Not verified** — no remote CI run |
| Staging exit | Not met | Still **Not met** |

---

## 8. Summary matrix

| Area | Grade | Notes |
|---|---|---|
| Auth crypto & session model | Good | Rotation race + invite revoke gaps |
| Authz (API) | Good | Module routes correctly gated |
| Authz (forced password) | Weak | Frontend-only |
| Rate limiting | Mixed | Login good; forgot broken |
| Logging / secrets | Weak | Header/cookie leak risk |
| Audit API surface | Good | Read-only |
| Frontend UX Phase 1 | Adequate | Edit/filter gaps; untested |
| Automated tests | Thin | 15 BE + 1 FE smoke |
| CI | **Unverified** | No git / no Actions runs |
| Docs accuracy | Overstated on several Dones | See §4 |

**Recommendation:** Harden V-01–V-06, correct the delivery report, establish git+CI, then stage. Only then open Phase 2.

---

## 9. Resolution status (2026-11-05 hardening)

| ID | Status | Fix summary | Regression |
|---|---|---|---|
| V-01 | **Fixed** | Atomic `findOneAndUpdate` claim in `refresh()` | Concurrent refresh test |
| V-02 | **Fixed** | `requirePasswordChanged` on auth/users/settings/audit | AUTH-007 API block test |
| V-03 | **Fixed** | `authStrictRateLimiter` on forgot/reset/invite | Forgot 429 test |
| V-04 | **Fixed** | `revokeAllUserSessions` in `acceptInvite` | Invite revoke test |
| V-05 | **Fixed** | pino-http `redact` via `PINO_HTTP_REDACT_PATHS` | `logging.test.ts` |
| V-06 | **Partial** | Local `git init` + commit; **CI still unverified** until GitHub remote push yields a green Actions run | N/A |

Also: audit Mongoose append-only hooks; Argon2id prefix assert; FE RequireAuth/permissions tests; PHASE1_REPORT statuses corrected.
