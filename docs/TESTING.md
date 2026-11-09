# Testing

Roof measurement PDF: `solar.professional.test.ts` checks every page for header, footer and `Page i of N`, the address-based download name, missing imagery, photos and structures; `report/pdf-kit.test.ts` covers continuation pages; `report/format.test.ts` covers file names and validation; `materials.product.test.ts` covers product packaging. To look at a real report: `npx tsx --env-file=.env scripts/measure-real.ts "<address>" <outDir>` then render the PDF (for example with Ghostscript) and inspect every page.

## Commands (repo root)

```bash
npm test                 # backend Vitest + frontend Vitest
npm run typecheck
npm run lint
npm run build
npm run test:e2e         # Playwright (frontend workspace)
```

### Workspace-specific

```bash
npm run test -w backend
npm run typecheck -w backend
npm run lint -w backend
npm run build -w backend

npm run test -w frontend
npm run typecheck -w frontend
npm run lint -w frontend
npm run build -w frontend
npm run test:e2e -w frontend
```

## Backend tests

- **Runner:** Vitest + Supertest
- **Database:** `mongodb-memory-server` replica set (see `backend/src/test/setup.ts`)
- Env vars for tests are set in setup (`JWT_ACCESS_SECRET`, `MONGODB_URI`, etc.) — do not point tests at production MongoDB
- Fixtures: `backend/src/test/phase2-fixtures.ts`

Coverage includes auth (login/refresh/logout/password change/mustChangePassword gate), users, settings, leads, customers, appointments, inspections, files, measurements, estimates, proposals, projects, invoices, communications, after-sales, analytics, portal ownership.

## Frontend tests

- **Runner:** Vitest + Testing Library + jsdom
- Route guard tests (`RequireAuth`)
- Change-password page validation + success navigation
- Permissions helper smoke tests

## Playwright E2E

Config: `frontend/playwright.config.ts`  
Specs: `frontend/e2e/`

| Spec | Purpose | Env |
|---|---|---|
| `auth-password-change.spec.ts` | Login → forced password change → dashboard → leads → refresh | `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_NEW_PASSWORD` (defaults exist for local recovery only) |
| `crm-smoke.spec.ts` | Dashboard / leads / customers / calendar | `E2E_EMAIL`, `E2E_PASSWORD` |
| `w1-door-knock.spec.ts` | Door-knock lead create | Requires credentials |
| `w2-website-intake.spec.ts` | Public intake API path | Running API + secret |

```bash
cd frontend
npx playwright install chromium
$env:E2E_EMAIL='...'; $env:E2E_PASSWORD='...'
npx playwright test --project=chromium
```

Requires Vite frontend (`npm run dev -w frontend`) and API (`npm run dev -w backend`) already running for UI specs that hit `E2E_BASE_URL` (default `http://localhost:5173`).

## Local admin recovery (dev only)

If the seeded admin is stuck with an unknown temporary password:

```bash
cd backend
node --env-file=.env scripts/local-reset-admin-temp.mjs
```

Sets a local temporary password (`LOCAL_ADMIN_TEMP_PASSWORD` or default documented in the script) and `mustChangePassword: true`. **Do not use against production.**

## Browser E2E (Playwright) — current suites
| Spec | Needs | Notes |
|---|---|---|
| `auth-password-change` | admin in forced-change state (`node --env-file=.env scripts/local-reset-admin-temp.mjs`) | one run per reset |
| `crm-smoke` | `E2E_EMAIL` / `E2E_PASSWORD` (default admin123@gmail.com / LocalNewPass12!) | opens the mobile drawer on phones |
| `demo-workspace` | demo data (`npm run seed:demo -w backend`) | dashboard, navigation, kanban drag-and-drop, no overflow |
| `business-journey` | demo data + demo admin | lead → payment → portal, isolated records tagged per run |
| `w1-door-knock` | `E2E_EMAIL`, `E2E_PASSWORD` of a salesperson | |
| `w2-website-intake` | `E2E_API_URL` = API origin **without** `/api/v1`; intake secret configured on the API | |

Run with `E2E_BASE_URL=http://localhost:<spa-port> npx playwright test --workers=1`. The login rate limiter is intentionally active: specs sign in once per run. Use **one** backend/frontend pair at a time (the refresh cookie is shared across ports on `localhost`).

## Real-MongoDB verification (dev)
The app needs a replica set. Without Atlas or Docker: `mongod --dbpath backend/.mongo-data --replSet rs0 --port 27018 --bind_ip 127.0.0.1`, then `node backend/scripts/dev-mongod-init.mjs`, and `MONGODB_URI=mongodb://127.0.0.1:27018/legacy-roofing-crm?replicaSet=rs0`.

## Client-requirements coverage (2026-11-06)
Backend (142 total at the end of this session): form engine 9 (includes a drift test that `backend/src/modules/forms/engine.ts` equals `shared/form-engine.ts`), forms API 9, intake 5, PDF report 2, quote engine 9, pricing API 7. Frontend (26 total): offline store and sync 6, `FormRenderer` 3. Run `npm run sync:shared` after editing `shared/form-engine.ts`; `npm run check:shared` fails if the copies drift.
Browser: `e2e/client-requirements.spec.ts` (form templates, DRAFT catalog, intake with consent, remodeling inspection, **offline edit then auto-sync**, gutter inspection, roofing completion blocked by the photo checklist, quote to estimate to cost and margin, mobile overflow check). It needs the demo seed and unique data per run (it uses a run tag, so duplicate detection does not trip).
In this session `auth-password-change` (single use per password reset), `w2-website-intake` (needs the intake secret and an API origin without `/api/v1`) and the portal step of `business-journey` (needs `E2E_API_URL=http://localhost:<api>/api/v1`) were environment-dependent; see the final report in `CLAUDE_EXECUTION_STATUS.md`.

## Additional automated coverage added
`journey.routes.test.ts` (API lead→payment→portal), `files.project.routes.test.ts` (project documents, scope, limits, portal visibility), `dashboard.seeded.test.ts`, `demo-data.test.ts`, `lib/datetime.test.ts` (time zones / DST), `modules/auth/bootstrap.test.ts` (single-flight session restore).

## Known limitations
- Portal proposals/projects/documents pages are verified by backend route tests, not browser tests.
- External providers are not live-tested (adapters report "not configured").
- Mobile layout is verified by an automated overflow scan plus screenshots, not by device testing.


## Roof measurement coverage (Google Solar)

All Google responses in tests are **fixtures** (`modules/measurements/solar/fixtures.ts`); none is a live Google result. The adapter override exists only when `NODE_ENV=test`.

- `solar.unit.test.ts` (26): unit conversion, pitch from degrees, compass, waste table (applied once), normalization (area, squares, pitch distribution, skipped segments, whole-roof mismatch, NO_ROOF_DATA), adapter (endpoint and key placement, HTTP 404/429/403 billing/403 API disabled/400 key/400 coordinates/500, timeout, network, no key leak, geocoding statuses), edge classification on synthetic gable, hip and valley roofs, ambiguous edges, "unavailable" placeholders.
- `solar.routes.test.ts` (18): import with provenance, duplicate prevention (repeat and concurrent), revisions, HIGH to BASE fallback, error mapping without leaks, not configured, daily and monthly limits and usage (admin only, key never returned), connection test, geocoding precision and no duplicate properties, address search cost control, corrections and history, estimate inputs and snapshot, PDF content, company and owner isolation, manual measurements unchanged.
- Browser: `e2e/roof-measurement.spec.ts` against `backend/scripts/e2e-solar-server.ts` (mock Google): connection test, address to measurement, imported figures and "manual required" edges, segment selection, correction and verification, PDF response, estimate pre-fill, mobile overflow. **Not a live Google test.**
- Live Google: not run (no key available in this environment).

### Connection test coverage (added 2026-11-06)
Mocked: endpoint, sample location and key placement; missing key; malformed or empty 200 body; API disabled, billing, key restricted, invalid key, quota, HTTP 500; timeout and network failure without URL or key leakage; Connected only after success and replaced by a later failure; key replacement invalidates the result; admin-only; secret redaction helper; the Integrations hub status. Frontend: the integration page shows "Configuration required", then refreshes to "Connected" (and refetches the Integrations hub) after the test, and shows HTTP status and the fix on failure.
**Real Google** (not a mock): `scripts/check-google-solar.ts` and the live Test connection button succeeded against the real API; a real address (Mountain View, CA) was measured through the full `/run` pipeline and a PDF was generated.


### Professional measurement coverage
Fixtures only (synthetic gable, hip, cross-gable valley, flat, two structures, noisy DSM, no mask); no paid Google request in the normal suite. Backend (`solar/`): geometry extraction against roofs of known size (`derive.test.ts`), GeoTIFF round trip, download protections, aerial crop, diagrams for every roof type (`reader.test.ts`), end-to-end routes with a mocked Data Layers service (`solar.professional.test.ts`: footprint and facets, no repeat requests, imagery failure fallback, retention and switches, daily limit, edge review and history, manual edges, waste and materials, suggested quantities, photos, 11- and 12-page PDFs with embedded images, missing-imagery PDF, additional structures, revisions and estimate snapshot, company/owner isolation, records without timestamps). Browser: `e2e/roof-measurement.spec.ts` against `backend/scripts/e2e-solar-server.ts` (aerial image decoded in the page, vector tabs, edge review, waste, photo upload, corrections, PDF, estimate pre-fill, mobile layout). Dev aids: `SAVE_SAMPLE_PDF=<path>` saves the PDF from the PDF test for inspection; `scripts/measure-real.ts` runs the real pipeline for one address (billable within the free allowance).
