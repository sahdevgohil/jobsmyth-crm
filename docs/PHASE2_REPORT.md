# Phase 2 — Core CRM Delivery Report

| Field | Value |
|---|---|
| Project | Legacy Roofing CRM |
| Client | Legacy Construction Group |
| Phase | 2 — Leads and Customers (Core CRM) |
| Report date | 2026-11-05 (updated after verification hardening) |
| Related | [PRD.md](./PRD.md) · [PROJECT.md](./PROJECT.md) · [DECISIONS.md](./DECISIONS.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [PHASE1_REPORT.md](./PHASE1_REPORT.md) |

---

## 1. Executive summary

Phase 2 Core CRM is **implemented and hardened** after independent verification (V2-01–V2-05, V2-09–11, V2-14, V2-17–18, V2-20). Local `lint` / `typecheck` / `test` / `build` are the gate for this report update. Working defaults from [DECISIONS.md](./DECISIONS.md) remain for Q-002/003/005/006/028/030. MIG/CSV was **not** implemented (Q-021).

See also [PHASE2_VERIFICATION_REPORT.md](./PHASE2_VERIFICATION_REPORT.md).

**Exit criteria status** (PROJECT.md §7)

| Criterion | Status |
|---|---|
| W-1 Door-knock lead → usable on app (create, list, detail, stage, follow-up) | **Met locally** — API + SPA; Playwright UI E2E gated on `E2E_*` env |
| W-2 Website inquiry → CRM lead | **Partial** — public intake API hardened (idempotent under concurrency; best-effort notify); **live website form blocked** on Q-006 / INT-09 |
| Dashboard with lead & customer metrics only | **Met locally** (aggregations); tile deep-links **Partial** (DASH-005) |
| Staging demo of W-1 / W-2 | **Not met** — staging host blocked on Q-027 / D-029 |
| CSV import (MIG) | **Out of scope** until Q-021 approved |
| Sentry (INT-10) | **Not installed** — structured logs only |

Phase 1 auth/users/settings/audit preserved; Phase 2 only extended shared wiring (permissions, routers, seed model for stages, env).

---

## 2. Requirement coverage

### 2.1 Dashboard (DASH-001–006) — Phase 2 slice

| ID | Status | Notes |
|---|---|---|
| DASH-001 Live DB metrics | Done | `GET /analytics/dashboard` |
| DASH-002 Only built-module tiles | Done | Lead + customer + overdue follow-ups + recent activities; no appointments/projects/revenue tiles |
| DASH-003 Admin company-wide / salesperson own | Done | Scope in service; AC-DASH-2 automated |
| DASH-004 Date-range filter | Done | Query `from`/`to`; default current UTC month start → now |
| DASH-005 Tile links | **Partial** | Tiles link to list routes; only overdue uses a filter query. Full filtered destinations deferred. |
| DASH-006 Aggregated endpoint | Done | Single dashboard endpoint |

**Acceptance**

| AC | Result |
|---|---|
| AC-DASH-1 Independent query match | Pass (automated) |
| AC-DASH-2 Salesperson scope | Pass (automated) |
| AC-DASH-3 No hardcoded metric values | Pass (computed in service) |

### 2.2 Lead management & pipeline (LEAD-001–016)

| ID | Status | Notes |
|---|---|---|
| LEAD-001 Manual create (name + phone/email) | Done | |
| LEAD-002 Required source from lookups | Done | Seeded sources |
| LEAD-003 Website intake | Done (API) | `POST /public/website-leads`; live form pending Q-006 |
| LEAD-004 Phone leads (manual) | Done | Source `phone_call` |
| LEAD-005 Auto-assign | Done | Round-robin `receivesLeads`; self-assign for salesperson create; Admin reassign |
| LEAD-006 Configurable stages | **Partial** | Admin API supports create/rename/reorder/deactivate; UI is create + deactivate only (rename/reorder UI deferred) |
| LEAD-007 Seed stages | Done | Full LEAD-007 list in production seed |
| LEAD-008 Stage-change activity | Done | |
| LEAD-009 Lost reason required | Done | `422 LOST_REASON_REQUIRED` |
| LEAD-010 Follow-ups | Done | Create / complete; overdue on list + dashboard |
| LEAD-011 Timeline | Done | Notes, calls, follow-ups, stage, assignment, conversion |
| LEAD-012 Conversion | Done | Customer (+ property if address); idempotent; no project (Phase 3) |
| LEAD-013 Duplicate detection | Done | Phone E.164 / email / address key; website flags `possibleDuplicateOf` |
| LEAD-014 List filters + search | Done | |
| LEAD-015 Pipeline (kanban) view | **Partial** | Column view with **select-to-move** (same stage API). Drag-and-drop not implemented. |
| LEAD-016 Referral + service interest | Done | Fields on model / create |

**Acceptance**

| AC | Result |
|---|---|
| AC-LEAD-1 Website intake idempotent; notification best-effort after commit | Pass (automated: sequential + concurrent idempotency; notify failure still 201) |
| AC-LEAD-2 Phone format duplicate match | Pass (automated) |
| AC-LEAD-3 New stage without deploy | Pass (automated) |
| AC-LEAD-4 Convert twice → one customer | Pass (automated) |
| AC-LEAD-5 Salesperson out-of-scope → `404` | Pass (automated) |

### 2.3 Customers & properties (CUST-001–009)

| ID | Status | Notes |
|---|---|---|
| CUST-001 Customer fields | Done | `individual` / `business` + contacts |
| CUST-002 Property fields | Done | Manual address (no maps) |
| CUST-003 One customer → many properties | Done | |
| CUST-004 Customer detail related data | Partial | Leads + properties shown; projects/estimates/invoices omitted (not in Phase 2) |
| CUST-005 Property detail | Partial | Address/type only (no inspections yet) |
| CUST-006 Communication history | Deferred | Needs COMM (Phase 8) |
| CUST-007 Duplicate detection on create | **Partial** | API `POST /customers/duplicate-check` + shared helper; **not wired in Customer create UI** |
| CUST-008 Archive / hard-delete rules | Done | Archive; delete only with no relations (Admin) |
| CUST-009 Maps optional | Done | Manual entry always works |

**Acceptance**

| AC | Result |
|---|---|
| AC-CUST-1 Two properties on customer | Pass (via convert + property create path / summary) |
| AC-CUST-2 Archive hides from default lists | Done (API `archivedAt` + default list filter) |
| AC-CUST-3 Address without maps | Done |

### 2.4 Cross-cutting

| ID | Status | Notes |
|---|---|---|
| AUD-002 (Phase 2 actions) | Done | Lead assign/stage/convert, website intake, customer/property, pipeline stages |
| SEC-005 Out-of-scope `404` | Done | Lead/customer scope filters |
| SEC-010 Public intake | Done | Shared secret, honeypot, **dedicated** intake rate limiter, concurrent-safe idempotency, best-effort notifications after commit |
| NFR-001 Mobile field flows | Partial | Responsive pages; Playwright mobile project present (env-gated) |
| INT-10 Sentry | Not started | Pending account |

---

## 3. What was built

### Backend (`/api/v1`)

| Area | Endpoints |
|---|---|
| Pipeline stages | `GET/POST /settings/pipeline-stages`, `POST .../reorder`, `PATCH .../:id` |
| Leads | `GET/POST /leads`, `GET/PATCH /leads/:id`, `POST .../duplicate-check`, `.../stage`, `.../assign`, `.../convert` |
| Public intake | `POST /public/website-leads` (`X-Website-Lead-Secret`) |
| Customers | `GET/POST /customers`, `GET/PATCH/DELETE /customers/:id`, `POST .../archive`, `.../summary`, `.../properties`, `POST .../duplicate-check` |
| Properties | `GET/PATCH /properties/:id` |
| Activities | `GET/POST /activities`, `POST /activities/:id/complete` |
| Notifications | `GET /notifications`, `GET .../unread-count`, `POST .../read-all`, `POST .../:id/read` |
| Analytics | `GET /analytics/dashboard` |

**New / extended collections:** `leads`, `activities`, `customers`, `properties`, `notifications`, `pipelineStages` (Mongoose model + Admin UI), company `leadAssignment.lastAssignedUserId`.

**New deps:** `libphonenumber-js`, `date-fns`, `@date-fns/tz` (backend); `@playwright/test` (frontend E2E).

### Frontend

| Route | Purpose |
|---|---|
| `/app` | Live dashboard tiles |
| `/app/leads`, `/new`, `/pipeline`, `/:id` | List, create, kanban, detail + timeline/convert |
| `/app/customers`, `/new`, `/:id` | List, create, detail + properties |
| `/app/properties/:id` | Property detail |
| `/app/pipeline-stages` | Admin stage management |

Nav: Leads, Customers, Stages (Admin); unread count badge (notification count).

### Explicitly not built

MIG/CSV; appointments; projects; files/inspections; Redis/BullMQ/worker; maps SDK; email/SMS; Sentry; Phase 3–8 modules.

---

## 4. Test evidence

| Suite | Result |
|---|---|
| Backend Vitest + Supertest | **45 passed** (includes V2-01/02/03/04/05/10/14/17 regressions + escape-regex) |
| Frontend Vitest | **6 passed** — `e2e/**` excluded; Playwright specs not loaded |
| Playwright E2E | Skipped unless `E2E_*` set against a live stack |
| `npm run lint` / `typecheck` / `build` | Pass (hardening delivery) |

Working decision recorded as **D-036** in [DECISIONS.md](./DECISIONS.md). Hardening follow-up: atomic RR, intake 11000 handling, stage create/deactivate guards, Vitest/E2E split.

### Deferred findings (accepted for Phase 2 close)

| ID | Item | Disposition |
|---|---|---|
| V2-12 | Non-constant-time intake secret compare | Deferred — low risk behind shared secret |
| V2-13 | Honeypot vs replay response shape | Deferred |
| V2-15 | Dashboard date-range UI | Deferred — API supports `from`/`to` |
| V2-16 | Dedicated customer suite gaps | Partial coverage via lead/convert paths; more tests later |
| V2-19 | ~~`customers:archive` on DELETE~~ | **Fixed** — route uses admin-only `customers:delete` |
| V2-21–V2-26 | Property type on update, contacts in dupes, etc. | Deferred low items |

### External blockers (unchanged)

| Item | Status |
|---|---|
| Q-006 / INT-09 live website form | **Open** |
| Q-027 / D-029 staging hosting | **Open** |
| Q-021 CSV import | **Not approved — not built** |
| INT-10 Sentry | **Open** |

---

## 5. How to run (local)

```bash
cd legacy-roofing-crm
npm install
cp backend/.env.example backend/.env   # set WEBSITE_LEAD_INTAKE_SECRET
cp frontend/.env.example frontend/.env
npm run seed
npm run dev
```

**Website intake smoke (curl):**

```bash
curl -X POST http://localhost:4000/api/v1/public/website-leads \
  -H "Content-Type: application/json" \
  -H "X-Website-Lead-Secret: <WEBSITE_LEAD_INTAKE_SECRET>" \
  -d "{\"submissionId\":\"demo-1\",\"firstName\":\"Web\",\"phone\":\"5125550100\"}"
```

**Optional E2E:**

```bash
# API intake
set E2E_API_URL=http://localhost:4000
set E2E_INTAKE_SECRET=<same as backend>
npm run test:e2e -w frontend

# UI door-knock (also needs SPA running)
set E2E_BASE_URL=http://localhost:5173
set E2E_EMAIL=<salesperson@...>
set E2E_PASSWORD=<password>
```

---

## 6. Open items and blockers

| Item | Impact | Owner |
|---|---|---|
| **Q-006 / INT-09** Website platform & form POST capability | Blocks claiming W-2 “live on real site” | Client / web vendor |
| **Q-027 / D-029** Hosting | Blocks staging exit / M2 formal demo | Client + developer |
| **Q-002 / Q-003 / Q-005** Confirm assignment, visibility, stages | Code uses working defaults; client may change | Client |
| **Q-021** CSV import | Not built | Client |
| **INT-10** Sentry | Observability not upgraded | Client + developer |
| Playwright E2E against staging | Needs running stack + credentials | Developer after staging |

---

## 7. Client demo checklist (local or staging)

1. Seed Admin + create salesperson with **Receives leads**.
2. As salesperson: **New lead** (door knocking) → appears in list → add note/follow-up → change stage.
3. As Admin: open **Pipeline / Stages**, add a stage → appears in lead stage picker without redeploy.
4. Convert lead with address → customer + property; convert again → same customer.
5. Salesperson cannot open another salesperson’s lead (`404`).
6. POST website intake with secret → lead `source=website`; assignee notification is best-effort (lead create succeeds even if notify fails); replay same `submissionId` → no second lead.
7. Home dashboard tiles match list counts for that user’s scope.
8. (When Q-006 closed) Wire real site form to intake URL + secret header.

---

## 8. Recommendation

- Treat Phase 2 **local code as ready to close** after hardening (High verification items addressed).
- Close **Q-006** for live W-2; close **Q-027** for staging M2 / formal exit.
- Confirm working defaults Q-002 / Q-003 / Q-005 with the client before Phase 3.
- Phase 3 may start once High findings stay green in CI **and** the client accepts staging waiver or staging is available (PROJECT.md §7).

---

## 9. Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Developer | | 2026-11-05 | Phase 2 hardened (High V2 findings fixed); ready for client review. Staging (Q-027) + live website form (Q-006) still external blockers. |
| Client | | | Pending review |
