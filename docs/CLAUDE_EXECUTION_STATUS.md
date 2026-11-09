# Execution status — stabilization and completion session (2026-11-05/06)

Legend: **Implemented** = code exists · **Tested** = covered by an automated test that passed in this session · **Blocked** = needs something outside the code · **Deferred** = intentionally not done.

## Final gate results (exact)
| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` (backend + frontend) | pass |
| Backend Vitest | **101 passed** (28 files) |
| Frontend Vitest | **17 passed** (6 files) |
| Playwright `auth-password-change` | 2 passed (chromium, Pixel 5; each needs a fresh `local-reset-admin-temp` first) |
| Playwright `crm-smoke` + `demo-workspace` + `business-journey` | 16 passed, 10 skipped by design (desktop-only tests on the Pixel 5 project) |
| Playwright `w1-door-knock` (salesperson creds via env) | 2 passed |
| Playwright `w2-website-intake` (`E2E_API_URL=http://host:port`, intake secret set) | 2 passed |
| Mobile overflow scan, 41 routes at 390 px | 0 overflowing pages |

Playwright was run against a dev stack on ports 4300/5300 backed by a **real mongod 8.0 replica set** (see below).

## Stage 1 — test failures (fixed, cause identified)
Eight test files had passwords changed to `Admin@123` (9 chars) between 22:23 and 22:24 on 2026-11-05 — after the previous green run, outside the previous session, and not committed to git (several files are untracked, so history cannot name the author). The production minimum of **12 characters was not touched**. The original valid values were restored (`TempPassword12!`, `InviteAccepted12!`, `PortalNewPass12!`, `LocalNewPass12!`, and a distinct confirmation value for the "mismatch" test, which the replacement had silently turned into a non-mismatch).

## Stage 2 — demo data and database (verified on real MongoDB)
- A system MongoDB 8.0 is installed but its Windows service is stopped and cannot be started without administrator rights; it is also a standalone server (no transactions). I therefore ran the installed `mongod.exe` myself as a **single-node replica set `rs0` on port 27018** with a private data directory (`backend/.mongo-data`), initiated with `backend/scripts/dev-mongod-init.mjs`. This is a real mongod, but a developer setup — **not** Atlas and **not** the user's own service on 27017.
- `seed:demo` run twice against it: identical counts both times (577 records, no duplicates); invoice/payment mismatches: 0.
- `seed:demo:reset` removed exactly the 577 demo records; a manually inserted non-demo customer survived; configuration (stages) was kept. Reseed restored everything.
- Guards verified: `NODE_ENV=production` is refused; a non-local `MONGODB_URI` is refused for seed and reset.
- Tested: `scripts/lib/demo-data.test.ts` (7), `dashboard.seeded.test.ts` (4, in-memory replica set).

## Implemented and tested
| Area | Notes |
|---|---|
| Customer workspace | 14 tabs (overview/edit, properties incl. add, leads, appointments, inspections, measurements, estimates, proposals, projects, invoices, payments, documents, communications, after-sales), portal account status + staff-created portal account. Real APIs; verified in browser. Backend additions: `relatedLeads`, portal account status endpoint, payments `customerId` filter. |
| Project workspace | Overview/edit, tasks (create + status), work orders (create + status) and subcontractors in use, materials (status), inspections and measurements, estimate and proposal, documents, finance (budget vs invoiced/collected + invoices + payments), activity timeline. Status transitions use the existing rule table (server authoritative). |
| Property workspace | Roof details, inspections, measurements, projects, photos and documents. |
| Remaining list pages | Appointments, inspections, measurements, estimates, proposals, projects, materials, users, audit logs via shared `ListPage` (search, filters, badges, pagination, states); after-sales and communications rebuilt with pickers (no more pasted IDs). |
| Forms | Inspection, measurement, estimate, project, invoice, appointment forms use a customer→property picker and linked-record selects instead of raw database IDs. |
| Calendar | Month, week, day, list; navigation, status/employee filters, create from a day, edit, reschedule with conflict confirmation; all times in company time (`America/Chicago`) via `lib/datetime.ts` (DST-tested). |
| Files | Reusable `FilePanel` (client type/size validation, upload, preview, download, customer/internal visibility). Backend: project documents (`projectId` on upload/list, inherits customer, scope-checked). Tested: scope, 415/413, no storage paths in responses, portal sees only customer-visible files of its own customer. |
| Lead board | Drag-and-drop plus keyboard select; Won only via conversion; Lost asks for a reason; converted leads locked; server errors shown. Drag-and-drop tested in a real browser. Lead assignment control added to lead detail. |
| Reports & analytics | One page (sales / operations / finance) with charts. A separate Analytics page was **deliberately not created** (it would duplicate the same aggregations). |
| Invoice | Branded printable invoice, line items, payment history. |
| Browser journey | login → lead → assignment → conversion → customer/property → appointment → inspection + photo → measurement → estimate (server total checked: $10,825.00) → proposal → approval → project → task → work order → invoice → partial payment (balance $600.00) → portal login → ownership isolation. |
| Bug fixes | (1) `paginationMeta` argument order in 7 endpoints. (2) **Session bootstrap race:** React StrictMode ran the refresh call twice; token-reuse detection then revoked the whole session, so a full page reload logged users out in development. Fixed with a single in-flight request (staff and portal), unit-tested. (3) Dashboard date semantics. |
| Branding | Official logo assets, charcoal / red / grey / white tokens (secondary text `#757575`, decorative grey `#898989`). |

## Blocked
- Live providers: Roofr, Dropbox Sign/DocuSign, QuickBooks, Resend, Twilio, S3/R2, Sentry, live website form. All show **Not configured**; internal workflows do not depend on them.
- Starting the user's own MongoDB Windows service (needs administrator rights). Their service is standalone; the app requires a replica set (transactions).

## Deferred (not done)
- Estimate/proposal file attachments: the file model has no estimate/proposal link.
- A separate subcontractor detail page ("assigned projects" is shown on the project, not on the subcontractor).
- DateRangePicker (preset ranges are used) and a standalone `DetailPanel`/`DocumentPreview` (preview opens the file in a new tab).
- Visual redesign of Estimate, Proposal, Inspection, Measurement and Settings/Lookups/Pricing *detail/editor* pages beyond the shared tokens, buttons and logo.
- Demo seed does not create uploaded files, audit entries or notifications.
- Browser E2E for the customer portal covers login, password change, invoices and API-level isolation only; proposals/projects/documents portal pages are covered by backend route tests.

## Known issues / notes
- The kanban E2E moves a lead and moves a lead back; the same *count* is restored but not necessarily the same lead.
- The login rate limiter (default 10 failed attempts / 15 min) is kept. `AUTH_RATE_LIMIT_MAX` raises it **only outside production** (set in the developer's local `backend/.env`).
- Several dev servers share the `localhost` refresh cookie; run one backend/frontend pair at a time when testing.
- The unexplained `Admin@123` edits (Stage 1) should be traced by whoever made them.

## Exact next steps
1. Decide whether to keep the Cursor-era `PROJECT.md` scope for estimate/proposal attachments (needs a `File` link).
2. Redesign the remaining detail/editor pages to match the project workspace.
3. Run the stack against Atlas or a real replica set in staging and repeat the journey there.

---

# Session 3 checkpoint — client requirements (forms, inspections, pricing, offline)  [complete for this session]

Baseline at start: backend 101 / frontend 17 passing, lint + typecheck clean. The three client documents are **not in the repository**; their content was supplied in the task text and is used verbatim.

## Done and tested (backend)
- Tenant decision doc; `Company`, `User.companyId`, company resolved server-side in `authenticate`; new permissions.
- Shared form engine (`shared/form-engine.ts`, synced copies + drift test): 15 field types, conditions, computed fields, required/photo rules, sensitive redaction.
- Form templates + immutable published versions + submissions (idempotent `clientId`, revision conflicts, offline `POST /forms/sync`), default client templates (intake, roofing job details, roofing inspection, remodeling, 7 other services).
- Photos on submissions (`File` gained submission/field/tag/GPS/clientId; retried uploads stored once).
- Customer intake → customer + property + lead + per-channel consent (wording + version + timestamp; unanswered ≠ consent).
- Branded PDF report (pdfkit) for completed forms; acknowledgement-only wording.
- Pricing: Good/Better/Best catalog (draft by default), quote engine, estimate from catalog with snapshot, proposal block for unapproved/expired pricing, subcontractor rate cards (internal), cost sheets, gross margin, audited overrides.

## Done and tested (frontend and tooling)
- Offline layer (`modules/offline`): IndexedDB store, sync manager, optional-GPS photo queue, signature pad, conflict resolution UI, header sync pill.
- Pages: intake, field mode (list and fill), form templates and builder, price catalog, quote builder, subcontractor rate cards, cost and margin panel.
- PWA: manifest, service worker (app shell and static assets only), offline session limited to field mode.
- Demo seed extension, browser spec `client-requirements.spec.ts`, docs (traceability, tenant, form builder, inspections, offline, pricing, subcontractor costs, testing, demo data).

## Final gates (this session)
Backend 142/142, frontend 26/26 unit tests; `npm run lint`, `typecheck`, `check:shared`, `build` pass; `client-requirements.spec.ts` 9 passed (8 chromium, 1 mobile; others skipped by design). One regression found and fixed: file storage keys are now company-prefixed (test expectation updated to require the prefix). One bug found by the browser journey and fixed: the intake picker listed admins as assignable representatives. The offline-sync browser step failed once and then passed 5 consecutive runs; the template cache check was added in between, and the cause of the single failure was not isolated.

## Not done (honest list)
Multi-company migration of existing records (blocked on a client decision); branding screen and branded UI/PDF per company; inspection-to-estimate measurement import; project estimated-vs-actual costs; submission history screen; offline intake; embedded map; real-phone offline testing; demo photos/completed reports; a full lead-to-invoice browser journey including the new forms (the existing `business-journey` covers lead-to-payment without them).
