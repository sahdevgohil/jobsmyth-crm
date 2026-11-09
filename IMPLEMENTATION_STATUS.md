# Legacy Roofing CRM — Implementation Status

**Last updated:** 2026-11-06  
**Source of truth for intended scope:** root `PROJECT.md`  
**Source of truth for code:** this repository  

Status values: `Not started` | `In progress` | `Implemented` | `Tested` | `Blocked` | `Deferred`

---

## Checkpoint — current execution

| Field | Value |
|---|---|
| Last session | 2026-11-06 roof measurement from an address via Google Solar (`docs/MEASUREMENT_WORKFLOW.md`, `docs/GOOGLE_SOLAR_SETUP.md`), after client requirements: forms, inspections, offline, pricing (`docs/CLIENT_REQUIREMENTS_TRACEABILITY.md`) |
| Test results | Backend **186 passed**; frontend **26 passed**; lint, typecheck, `check:shared` and builds pass; new Playwright spec 9 passed (chromium 8 + mobile 1; the rest skipped by design) |
| Database verification | Real mongod 8.0 single-node replica set (port 27018, developer setup). Not Atlas. |
| Implemented + tested | Customer / project / property workspaces, list pages, calendar (4 views), file panel, lead board (drag and drop), reports, demo seed, browser journey lead→payment→portal |
| Client requirements | Form builder, intake with consent, 11 default templates, field mode (offline PWA), PDF reports, Good/Better/Best catalog (DRAFT), subcontractor rate cards, cost sheet and gross margin: **Tested**. See the traceability doc for partial items |
| Blocked | Multi-company migration of existing records (decision needed); All external providers (not configured); starting the user's own MongoDB service (needs admin rights) |
| Deferred | Estimate/proposal attachments, subcontractor detail page, DateRangePicker, redesign of remaining editor pages |
| Decisions | 12-character password minimum preserved; secondary text `#757575`; charcoal/red/grey/white brand; Reports and Analytics merged into one page |

---

## Professional measurement upgrade (2026-11-06)

| Area | Status |
|---|---|
| Google Data Layers (RGB, DSM, mask) download and decode | Tested; real Google verified |
| Roof footprint, facets, edges from raster data | Tested on synthetic roofs and run on 2 real addresses; accuracy not validated |
| Vector diagrams, aerial overlay, approximate fallback | Tested |
| Edge review with history and verification | Tested |
| Field photos, waste (8 scenarios), materials, estimate quantity pre-fill | Tested |
| 11-12 page branded PDF with aerial image | Tested; reviewed visually on real data |
| Measurement workspace UI | Tested (12 browser tests incl. mobile) |
| Imagery retention beyond 30 days, accuracy validation | Not done (terms review, ground truth needed) |

See `docs/MEASUREMENT_UPGRADE.md` and `docs/MEASUREMENT_UPGRADE_STATUS.md`.

## Roof measurement from an address (2026-11-06)

| Area | Status |
|---|---|
| Google Solar adapter (Building Insights, Data Layers, Geocoding), error mapping, key server-side only | Tested with fixtures; **live Google not verified** (no key available) |
| Normalization: area, squares, pitch from degrees, distribution, orientation, segments, waste | Tested |
| Edge lengths (ridge/hip/valley/eave/rake) | Not available from Google: manual entry. Polygon-based classifier exists, tested on synthetic roofs only |
| Corrections, verification, revisions, audit | Tested |
| Branded PDF with attribution and disclaimer | Tested |
| Estimate pre-fill and measurement snapshot | Tested |
| Usage ledger, limits, caching, admin integration page | Tested |
| Roof outlines / imagery overlay / Data Layers processing | Not built |
| Demo measurements, estimate and request ledger | Seeded |

Pages: `/app/measurements/solar/new`, `/app/measurements/usage`, measurement detail extended, quote builder pre-fill.

## Client requirements (2026-11-06)

| Area | Status |
|---|---|
| Company model, `companyId` on new collections, server-side company context | Tested (existing records not migrated: Blocked, see `docs/TENANT_ARCHITECTURE_DECISION.md`) |
| Form builder, versions, 15 field types, conditions, validation | Tested |
| Customer intake + per-channel consent | Tested |
| Roofing job details, roofing/remodeling/7 exterior inspections | Tested |
| Offline PWA, IndexedDB drafts, photo queue, sync, conflicts | Tested (unit, API, browser); phones untested |
| Branded PDF report | Tested |
| Good/Better/Best catalog (DRAFT), quote, estimate snapshot, proposal block | Tested |
| Subcontractor rate cards, cost sheet, gross margin | Tested |
| Branding UI, measurement import, history screen, project costs | Not started |

Pages added: `/app/intake`, `/app/field`, `/app/field/:clientId`, `/app/forms`, `/app/forms/:id`, `/app/price-catalog`, `/app/quote`, `/app/rate-cards`; cost panel on `/app/estimates/:id`; sync pill in the header.

## Module checklist

| Phase | Status |
|---|---|
| 1 Foundation | **Tested** |
| 2 Core CRM | **Tested** |
| 3 Appointments / inspections / files | **Tested** |
| 4 Measurements / estimates / pricing | **Tested** |
| 5 Proposals / materials / signature boundary | **Tested** |
| 6 Projects / subcontractors / work orders | **Tested** |
| 7 Invoices / payments / QBO boundary / finance summary | **Tested** |
| 8 Global search | **Implemented** (dedicated route test still thin) |
| 8 Customer portal | **Tested** (route tests + ownership isolation) |
| 8 Communication center UI | **Tested** (note + email `not_configured`) |
| 8 After-sales / expanded analytics | **Tested** (CRUD + sales aggregation tests; Reports UI) |
| System docs §22 | **Implemented** (`docs/API.md`, `DATABASE.md`, `INTEGRATIONS.md`, `TESTING.md`, `DEPLOYMENT.md`) |

### Auth / password-change (2026-11-05)

| Item | Status |
|---|---|
| Forced password-change middleware | Preserved |
| Password-change API | Verified (204 clears flag) |
| Frontend validation visibility | **Fixed** |
| E2E login → change → dashboard → leads → refresh | **Passed** |

### Blocked integrations (adapters only)

Roofr · Dropbox Sign / DocuSign · QuickBooks Online · Resend · Twilio · S3/R2 · Sentry · live website form (Q-006) · staging (Q-027)

### Excluded

Native apps · multi-tenant · insurance/Xactimate · subcontractor portal · CSV import (Q-021)

---

## Local run (staff)

1. MongoDB running at `MONGODB_URI`
2. `npm install`
3. Configure `backend/.env` and `frontend/.env`
4. `npm run seed` (first Admin) **or** local recovery: `node --env-file=.env scripts/local-reset-admin-temp.mjs` in `backend/`
5. `npm run dev:backend` and `npm run dev:frontend`
6. Open `http://localhost:5173/login` → change password if prompted → use `/app`

## Local run (portal)

1. Staff creates account: `POST /api/v1/portal/accounts` with `customerId`, email, temporary password
2. Open `http://localhost:5173/portal/login`
3. Change password when required → read-only proposals/projects/invoices/documents

---

## Exact next task

0. Add `GOOGLE_SOLAR_API_KEY`, enable billing, press Test connection and run one real address (docs/GOOGLE_SOLAR_SETUP.md). Review Google caching/attribution terms. Decide whether to build roof outline extraction from Data Layers to obtain edge lengths.
1. Client decisions: approve the draft price catalog and subcontractor rates; warranty terms and manufacturer eligibility; tax treatment; consent wording (legal); multi-company migration plan.
2. Build the company branding screen and apply `Company.branding` to the app shell and PDFs (the `branding:manage` permission exists; no UI yet).
3. Import inspection measurements into the estimate, add project estimated-vs-actual cost entries, and add a submission history screen.
4. Test field mode on real phones (airplane mode, production service worker cold start); consider offline intake.
