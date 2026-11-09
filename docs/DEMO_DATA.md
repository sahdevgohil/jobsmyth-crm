# Demo data (development only)

A deterministic demo dataset lets you evaluate the CRM with realistic, fully related records. Everything is fictional (names, `@example.test` / `*.demo.legacyroofing.test` emails, 555-01xx phone numbers, Texas addresses) and prices are illustrative, **not** company pricing or tax guidance.

## Commands (run from the repo root)

| Command | What it does |
|---|---|
| `npm run dev:db -w backend` | Starts a local single-node MongoDB replica set (via `mongodb-memory-server`, data in `backend/.devdb`) for machines without `mongod`. Use the printed URI in `backend/.env`. |
| `npm run seed:demo -w backend` | Ensures lookups/pipeline stages/company settings, then **upserts** the demo records by stable id. Safe to re-run; never deletes anything; dates are re-anchored to "now". |
| `npm run seed:demo:reset -w backend` | Deletes **only** the demo records (matched by their deterministic ids). Real records and configuration are left untouched. |

### Safety
- Both scripts refuse to run with `NODE_ENV=production`.
- Neither runs automatically (not on boot, not in CI deploys).
- Seeding requires a local `MONGODB_URI` (`localhost` / `127.0.0.1`) unless `DEMO_ALLOW_REMOTE_SEED=1`; reset additionally requires `DEMO_ALLOW_REMOTE_RESET=1` for a non-local database.
- Demo logins are printed only by the seed script (development). Override the password with `DEMO_USER_PASSWORD` (min 12 chars). Nothing is committed to the repo besides the default development password constant.

### Demo logins
| Role | Email |
|---|---|
| Admin | `admin@demo.legacyroofing.test` |
| Salesperson | `maria.delgado@…`, `tyler.brooks@…`, `priya.nair@demo.legacyroofing.test` |
| Customer portal (completed projects) | the email of the customer on `PRJ-<year>-D006` / `D007` (see Customers), same password |

Default password: `LegacyDemo!2026` (development only).

## What is created
36 leads (6 new, 5 contacted, 5 appointment set, 4 inspected, 5 estimate sent, 7 won, 4 lost; mixed sources and service types, overdue and upcoming follow-ups), 20 customers (3 business, 3 returning with two properties each), 23 properties, ~27 appointments (past/today/upcoming/cancelled), 19 inspections (17 completed, 2 pending), 15 measurements, 14 estimates, 13 proposals (draft / sent / accepted / rejected), 7 projects (planning, scheduled, in progress, on hold, quality review, 2 completed), 28 tasks, 5 subcontractors, 16 work orders, 14 materials + 42 material requirements, 10 invoices (draft / sent / partially paid / paid / overdue) with 7 payments, communications (internal notes; email and SMS attempts all honestly `not_configured`), 2 after-sales records and 2 portal accounts.

Document numbers use a `D` series (e.g. `EST-2026-D001`) so they can never collide with real sequential numbers.

## Consistency guarantees (tested)
`backend/scripts/lib/demo-data.test.ts` and `backend/src/modules/analytics/dashboard.seeded.test.ts` verify: every reference points to an existing record; estimate/proposal/invoice totals are integer-cent consistent; `amountPaidCents` equals the sum of recorded payments; statuses match balances; appointments per assignee do not overlap; dashboard KPIs, pipeline, revenue and outstanding totals equal independent queries; salespeople only see their own scope; seeding twice creates no duplicates.

## Forms, inspections and pricing (added 2026-11-06)
`seed:demo` now also (idempotently): ensures the default company, installs the 11 default form templates (published v1), installs the client price catalog and the subcontractor rate card as **DRAFT / unapproved**, and creates three **draft** inspections (roofing, remodeling, gutter) with fixed client ids on the first demo customer's property. Prices are the client figures from the task text; customers and addresses are fictional Texas data. `seed:demo:reset` removes those three submissions; templates, catalogs and rate cards stay (they are configuration). Not seeded: sample photos, completed inspections/reports, estimates built from the catalog.

## Not seeded
Uploaded photos/documents (there is no real file to store), audit logs and notifications. Upload files through the app.

## Verified behaviour (real mongod 8.0 replica set, 2026-11-06)
- Seeding twice gives identical counts (577 records); `amountPaidCents` always equals the sum of recorded payments.
- `seed:demo:reset` removes only the demo records; a manually added customer survived; lookups, stages and settings stay.
- `NODE_ENV=production` and non-local `MONGODB_URI` are refused. Demo users are matched by e-mail, so re-seeding keeps their ids; reset deletes those four demo users.
- Appointment slots are placed in business hours (company time) relative to the day you run the seed.
