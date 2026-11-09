# Legacy Roofing CRM — Implementation Audit

Audit date: 2026-11-05. Source of truth is the code; documents were used only as a guide.
Baseline re-run before any change: backend **85 passed**, frontend **10 passed**, typecheck **pass**.

## 1. Existing architecture
- Monorepo (npm workspaces): `backend/` (Express 5, TypeScript, Mongoose 8, Zod, pino, argon2, jose) and `frontend/` (React 19, Vite, Tailwind v4, React Router 7, TanStack Query, Zustand, RHF + Zod).
- Backend is a modular monolith: `backend/src/modules/<module>/{model,service,routes,validation,controller}`; adapters in `backend/src/services/{email,sms,storage,signatures,accounting}`; permissions in `backend/src/config/permissions.ts` (roles: `admin`, `salesperson`).
- Frontend: feature API hooks in `frontend/src/modules/*/api.ts`, pages in `frontend/src/pages`, one layout per audience (`AppLayout` staff, `PortalLayout` customer).
- Tests use `mongodb-memory-server` (replica set) so no local Mongo is required for tests. **No local `mongod` is installed on this machine**, so running the app needs either MongoDB or the new `dev:db` script (see Execution Status).

## 2. Existing modules (backend)
auth, users, settings (company, lookups, pipeline stages, pricing), audit, leads, customers/properties, activities, notifications, appointments, inspections, measurements, estimates, materials/requirements, proposals, projects/tasks, subcontractors, work-orders, invoices/payments, communications, after-sales, portal, search, analytics, files.

## 3. Working functionality (verified by tests/typecheck)
Auth + forced password change (`auth.routes.test.ts`), RBAC (`config/permissions.ts`), lead CRUD/assign/convert, customers/properties, appointments with conflict detection, inspections + printable report, measurements (manual, honest `manual_only`), estimates (backend-authoritative integer-cent math, `estimate.calc.ts`), proposals (snapshots), projects (transition table), invoices/payments (partial payments, idempotency keys), portal ownership isolation, communications (`not_configured` honesty).

## 4. Partially implemented
| Area | Finding | Location |
|---|---|---|
| Dashboard backend | Only lead/customer tiles + lead activity. No appointments, projects, invoices, pipeline, revenue, schedule. | `analytics.service.ts#getDashboard` |
| Lead model | No `priority`, no first-class follow-up date (only `Activity` of type `follow_up`), no property link. | `lead.model.ts` |
| Project detail | Page is 149 lines; does not expose work orders, subcontractors, materials, files or finances. | `ProjectDetailPage.tsx` |
| Reports | Page exists but plain lists. | `ReportsPage.tsx` |
| Search | No dedicated route test (status doc admits). | `search.routes.ts` |

## 5. Missing functionality
- **No frontend pages** for: Tasks, Work Orders, Subcontractors, Payments, Properties list, Integrations status. Backend APIs for subcontractors/work-orders/tasks/payments exist (`subcontractor.routes.ts`, `work-order.routes.ts`, `project.routes.ts`, `invoice.routes.ts`).
- No demo data or demo seed (existing `seed.ts` only creates config + an interactively-prompted admin).
- No integration status endpoint/screen (Part 9).
- No Playwright lead-to-payment journey.
- Lead kanban exists (`LeadPipelinePage.tsx`) but no calendar month/week/day toggle review done yet.

## 6. Broken / risky functionality
- Dashboard `newLeads`/`activeLeads` ignore the selected date range while `totalLeads` honours it — inconsistent semantics (`getDashboard`).
- `salespersonPerformance` issues 2 queries per salesperson (N+1) and ignores `receivesLeads`.
- Sales analytics `won`/`lost` use `updatedAt` as a proxy for the transition date, so any later edit moves a lead into the window.
- **Fixed:** `paginationMeta(input.page, input.pageSize, total)` had its arguments in the wrong order in invoices, materials, projects, proposals, subcontractors and work orders (`utils/pagination.ts` expects `(total, page, pageSize)`), scrambling `meta`.
- Workflow gap: `convertLead` forces the lead into the *Won* stage, but inspections/estimates require a `customerId`. Pre-sale inspections therefore need a manually created customer that is not linked via `convertedCustomerId`.

## 7. UI/UX problems
- `AppLayout.tsx` renders ~20 nav links in a wrapping header row, a "Password" link doubling as the notification badge, and a "Sign out" button; no sidebar, breadcrumbs, profile menu, mobile nav.
- Lists are bare `<ul>` rows (no table, sort, pagination controls, status badges); lead stage shown as raw names; `sourceKey` shown raw.
- Body background uses a radial gradient; palette differs from the brand tokens requested.
- Only three UI primitives (`button`, `input`, `label`); every page hand-rolls cards/tables.

## 8. Data model problems
- Lead lacks `priority` and `propertyId` (brief §6.1).
- `Activity.entityType` limited to lead/customer/project; no dashboard-level timeline for appointments, estimates, proposals, payments (solved by deriving events from source collections).
- `Inspection` requires `customerId`/`propertyId` (see §6 gap).
- Lookup `lead_source` lacks Google/Facebook/Referral/Existing customer; `project_category` lacks roof-specific service types (seed adds them idempotently).

## 9. Security findings
- Preserved: argon2id, refresh rotation, httpOnly cookies, forced password change, portal audience separation, rate limits.
- Dashboard/analytics scope is by `ownerId`/`assignedTo`; new dashboard code must keep that scoping (it does — see implementation).
- Demo seed is a new risk: it must never run in production, must not delete real data, and must not print credentials in production. Implemented with `NODE_ENV` guards and localhost-URI guard for reset.
- Frontend permission hiding is not a boundary; all new endpoints use `authorize()`.

## 10. Test coverage gaps
Thin: search, notifications, subcontractors, work orders, tasks, customers (no `customer.routes.test.ts`), activities. Frontend has 10 unit tests for 2 areas. No lead-to-payment E2E.

## 11. Integration limitations
Roofr, Dropbox Sign/DocuSign, QuickBooks, Resend, Twilio, S3/R2, Sentry, live web form: adapters only; none verified. UI must show *Not configured* — never *Connected* (implemented in new Integrations status page).

## 12. Recommended implementation order (and status)
1. Audit (this file) — done
2. Design foundation: tokens, sidebar/header shell, shared components
3. Dashboard backend + redesigned dashboard
4. Demo seed + reset + documentation
5. Missing pages: Work Orders, Tasks, Subcontractors, Payments, Properties, Integrations
6. Lead priority/follow-up fields, list upgrades (tables, filters, badges)
7. E2E journey, docs, final report

Progress is tracked in `docs/CLAUDE_EXECUTION_STATUS.md`.

## Update 2026-11-06
Findings fixed since this audit: wrong pagination metadata (7 endpoints); dashboard breadth; missing pages (tasks, work orders, subcontractors, payments, properties, integrations); raw-ID forms replaced by pickers; no lead assignment UI; session-bootstrap double refresh logging users out on reload (React StrictMode + refresh-token reuse detection). Open items are listed in `docs/CLAUDE_EXECUTION_STATUS.md`.
