# API Reference

**API version:** `v1`  
**Base path:** `/api/v1`  
**Health:** `GET /health` (outside `/api/v1`)

## Conventions

- JSON request/response bodies.
- Success payloads use `{ data: ... }` (lists may include `{ meta: { page, pageSize, total } }`).
- Errors use `{ error: { code, message, details?, requestId? } }`.
- Staff auth: `Authorization: Bearer <accessToken>` plus HTTP-only refresh cookie `refreshToken` (path `/api/v1/auth`).
- Portal auth: separate Bearer portal access token plus HTTP-only `portalRefreshToken` (path `/api/v1/portal/auth`).
- Users with `mustChangePassword` may only call staff `GET /auth/me`, `POST /auth/password/change`, and `POST /auth/logout` until the flag is cleared.
- Money fields are **integer cents**.
- Never returns password hashes.

## Staff authentication (`/auth`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/login` | No | Rate-limited. Returns access token + user (incl. `mustChangePassword`, `permissions`). Sets refresh cookie. |
| POST | `/auth/refresh` | Cookie | Rotating refresh. Origin checked when `Origin` present. |
| POST | `/auth/logout` | Optional | Revokes refresh session; clears cookie. |
| GET | `/auth/me` | Bearer | Current public user DTO. |
| POST | `/auth/password/change` | Bearer + `auth:change_password` | Body: `{ currentPassword, newPassword }` (12–128). Clears `mustChangePassword`; revokes other refresh sessions. **204** |
| POST | `/auth/password/forgot` | No | Strict rate limit. Opaque response; email delivery disabled until Resend configured. |
| POST | `/auth/password/reset` | No | Body: `{ token, newPassword }`. |
| POST | `/auth/invites/accept` | No | Body: `{ token, newPassword }`. |

## Users, settings, audit

| Area | Prefix | Key permissions |
|---|---|---|
| Users | `/users` | `users:manage` / `users:read` |
| Company settings | `/settings/company` | `settings:read` / `settings:update` |
| Lookups | `/settings/lookups` | `settings:read` / `settings:update` |
| Pipeline stages | `/settings/pipeline-stages` | `pipeline_stages:manage` |
| Pricing catalog | `/settings/pricing` | `pricing:manage` |
| Audit logs | `/audit-logs` | `audit:read` |

## Core CRM

| Area | Prefix | Notes |
|---|---|---|
| Leads | `/leads` | CRUD, assign, convert; salesperson scoped to assignee |
| Public website intake | `/public/website-leads` | Header `X-Website-Lead-Secret`; rate-limited |
| Customers / properties | `/customers`, `/properties` | Ownership scope for salesperson |
| Activities | `/activities` | Notes, follow-ups |
| Notifications | `/notifications` | Unread count + mark read |
| Appointments | `/appointments` | Calendar + CRUD |
| Inspections | `/inspections` | Linked to appointments/properties |
| Files | `/files` | Local storage; `visibility: internal \| customer` |
| Measurements | `/measurements` | Manual + Roofr adapter boundary |
| Estimates | `/estimates` | Integer cents line items |
| Materials | `/materials`, `/material-requirements` | Catalog + requirements |
| Proposals | `/proposals` | Send uses email/signature adapters (`not_configured` when unset) |
| Projects / tasks | `/projects` | Stages, tasks |
| Subcontractors | `/subcontractors` | Staff-only |
| Work orders | `/work-orders` | Status workflow |
| Invoices / payments | `/invoices` | Finance summary endpoints; QBO adapter boundary |

## Search

| Method | Path | Permission |
|---|---|---|
| GET | `/search?q=` | Authenticated staff (password changed) |

## Communications

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/communications` | `communications:read` | Filter `customerId`, `leadId`, `projectId` |
| POST | `/communications/notes` | `communications:create` | Internal notes; `customerVisible: false` |
| POST | `/communications/email` | `communications:create` | Persists adapter result; often `deliveryStatus: not_configured` |
| POST | `/communications/sms` | `communications:create` | Same honesty rules as email |

## After-sales

| Method | Path | Permission |
|---|---|---|
| GET/POST | `/after-sales` | `after_sales:read` / `after_sales:manage` |
| GET/PATCH | `/after-sales/:id` | same |

Warranty lookup keys must match active `warranty_type` lookups when provided. No invented warranty terms.

## Analytics

| Method | Path | Permission |
|---|---|---|
| GET | `/analytics/dashboard` | `analytics:dashboard` |
| GET | `/analytics/sales` | `analytics:dashboard` |
| GET | `/analytics/operations` | `analytics:dashboard` |
| GET | `/analytics/finance` | `analytics:dashboard` |

Optional query: `from`, `to` (ISO datetimes). Aggregations run in MongoDB with role scopes.

## Customer portal

### Account invite (staff)

| Method | Path | Auth |
|---|---|---|
| POST | `/portal/accounts` | Staff Bearer + `portal:manage` or `customers:update` |

Body: `{ customerId, email, temporaryPassword, firstName?, lastName? }`. Creates `CustomerAccount` with `mustChangePassword: true`.

### Portal auth (`/portal/auth`)

| Method | Path | Notes |
|---|---|---|
| POST | `/login` | Portal JWT audience `portal` |
| POST | `/refresh` | Portal refresh cookie |
| POST | `/logout` | |
| GET | `/me` | |
| POST | `/password/change` | |
| POST | `/password/forgot` | Opaque; email not sent until configured |
| POST | `/password/reset` | |

### Portal data (`/portal`)

All routes require portal Bearer + password changed. Scope is **always** the authenticated `customerId` (client IDs ignored for ownership).

| Method | Path |
|---|---|
| GET | `/proposals`, `/proposals/:id` |
| GET | `/projects`, `/projects/:id` |
| GET | `/invoices`, `/invoices/:id` |
| GET | `/files` |
| GET | `/inspections` |
| GET | `/communications` (customer-visible only) |
| GET | `/after-sales` |

Internal notes and internal-only documents are never returned.

## Important business rules

1. Backend permissions are authoritative (SEC-004).
2. Forced password change is enforced server-side for staff and portal.
3. Email/SMS/signature/QBO/Roofr adapters return `not_configured` until credentials exist — never claim live delivery.
4. Integer cents for all money; no floating currency math in API contracts.

## Additions (2026-11-05)

| Method | Path | Notes |
|---|---|---|
| GET | `/properties` | `search`, `customerId`, pagination; salespeople see only owned customers |
| GET | `/payments` | recorded payments (scoped), includes `invoiceNumber` |
| GET | `/tasks` | cross-project tasks, filters `status`, `assignedTo`, `projectId` |
| GET | `/integrations/status` | `settings:update`; honest provider status (never `connected` without verification) |
| GET | `/analytics/dashboard` | now returns `tiles`, `pipeline`, `salesPerformance`, `revenue`, `recentActivities`, `schedule`, `isEmpty` |

Leads accept/return `priority` (`low` \| `normal` \| `high`).


## Roof measurements from Google Solar (`/api/v1/measurements/solar`)

All routes need a staff session. Errors from Google use stable codes (`SOLAR_NOT_FOUND`, `SOLAR_NO_ROOF_DATA`, `SOLAR_NOT_CONFIGURED`, `SOLAR_LIMIT_REACHED`, `SOLAR_QUOTA_EXCEEDED`, `SOLAR_BILLING_DISABLED`, `SOLAR_API_DISABLED`, `SOLAR_AUTH_FAILED`, `SOLAR_TIMEOUT`, `SOLAR_NETWORK`, `SOLAR_BAD_RESPONSE`, `SOLAR_ADDRESS_NOT_PRECISE`, `SOLAR_DISABLED`) with fixed messages; provider text and the API key are never returned.

| Method and path | Permission | Purpose |
|---|---|---|
| GET `/status` | measurements:read | `not_configured`, `disabled`, `configuration_required`, `connected`, `connection_failed`, `quota_exceeded` (plus `lastTest`, `stale`) |
| GET `/address-search?q=&geocode=true` | measurements:order | CRM properties; with `geocode=true` also up to 5 Google address matches (one geocoding request) |
| POST `/run` | measurements:order | Body: `propertyId`, or `customerId` + `address` (+ `latitude`, `longitude`), `confirmApproximate`, `force`. 201 new, 200 reused (`meta.cached`) |
| GET `/property/:id/history` | measurements:read | All measurements/revisions for a property |
| PATCH `/:id/corrections` | measurements:update | `{changes, verify, reason}`; verify needs measurements:verify |
| GET `/:id/estimate-inputs` | measurements:read | Base squares, pitch, edge lengths, waste table, items still needed |
| GET `/:id/report?waste=&flatWaste=&regenerate=&inline=` | measurements:read | Branded PDF (stored as a file). Sent as an attachment named from the property address, e.g. `1532-Rebecca-Lane-Lancaster-TX-75134-Roof-Measurement-Report.pdf` (`-RevN` from revision 2; report number when there is no address); UTF-8 `filename*` plus ASCII fallback; `Content-Disposition` is CORS-exposed |
| GET/POST/PATCH/DELETE `/material-products[/:id]` | read: measurements:read; write: measurements:manage | Company material catalog (family, brand, name, package unit, coverage per package, enabled, spec confirmed) |
| GET `/usage` | measurements:manage | Monthly/daily counts, limits, warnings, recent requests |
| GET/PUT `/settings` | measurements:manage | Limits, quality, retention, prices (never the key) |
| POST `/test-connection` | measurements:manage | One real Building Insights request |

`GET /measurements/:id` now includes `solar` (null for manual records): revision, `automated` data, `fieldSources`, `verified`, `edges`, `counts`, `corrections`, `reportFileId`. `POST /pricing/estimates` accepts `measurementId` and records `pricingSource.measurement`.


### Professional measurement endpoints (`/api/v1/measurements/solar/:id/...`)

| Method and path | Permission | Purpose |
|---|---|---|
| GET `/summary` | measurements:read | Totals, pitched/flat area, pitch breakdown, structures |
| GET `/geometry` | measurements:read | Derived outline, facets, edges, imagery metadata (no Google links) |
| GET `/diagrams` | measurements:read | Five SVG diagrams, aerial overlay SVG, status and warnings |
| GET `/aerial.png` | measurements:read | Stored derived aerial image (404 none, 410 expired) |
| POST `/geometry/refresh` | measurements:order | One Data Layers request; a failure keeps the existing geometry |
| PATCH `/edges/:edgeId` | measurements:update | type, lengthFt, included, verification, note + `reason` (verification needs measurements:verify) |
| POST `/edges` | measurements:update | Add a manual edge (type, lengthFt, reason) |
| POST `/edges/verify` | measurements:verify | Verify listed edges, or all confident ones |
| PATCH `/waste` | measurements:update | `percent` (pitched) and/or `flatPercent`, from 0, 5, 10, 12, 14, 15, 17, 20, 22 |
| GET `/materials?waste=` | measurements:read | Separate pitched (0, 10, 12, 14, 15, 17, 20) and flat (0, 10, 12, 15, 17, 20, 22) waste tables, recommended percentages, and product-specific quantities per family at 0/10/14/15% waste |
| GET/POST `/photos`, PATCH `/photos/:fileId` | read / update | Field photos by category, metadata, verification |
| GET `/estimate-inputs` | measurements:read | Now also `selectedWastePercent`, `summary`, `suggestedQuantities` (verified vs unverified), `materials`, `geometryStatus` |

Settings gained `includeImagery`, `imageryRetentionDays`, `materialRules`. Superseded revisions reject edits with 409.

## Pipeline (`/api/v1/pipeline`)
| Endpoint | Permission | Notes |
|---|---|---|
| GET `/summary` | pipeline:read | `stages[]` (count, value, share of active), `totalActiveCents`, `activeJobCount`, `denied`, `calculation`, `limitations`. Filters: `from`, `to`, `salespersonId`, `projectManagerId`, `jobType`, `paymentStatus` (none, unpaid, partial, overdue, paid), `asOf` |
| GET `/jobs` | pipeline:read | the jobs behind a stage: `stage` (a stage key or `denied`), `search`, `sort` (stageDate, customer, value, outstanding, paid, number), `dir`, `page`, `pageSize`; returns `data`, `meta` and `totals` (equal to the card) |
| GET `/filter-options` | pipeline:read | salespeople, project managers and job types present in your scope |
| GET `/jobs/:id` | pipeline:read | job, full stage history, change orders |
| POST `/jobs/:id/move` | pipeline:manage | `{ toStage, reason }`; exceptions need a reason |
| POST `/jobs/:id/change-orders` | pipeline:manage | `{ description, amountCents }` (signed, non-zero) |
| POST `/backfill` | pipeline:manage | builds jobs for existing estimates and projects; repeatable |

Estimates: `POST /estimates/:id/accept`, `POST /estimates/:id/deny` (`{ reason, note? }`), `POST /estimates/:id/reopen` (`{ reason? }`), all `estimates:update`. Estimate objects now include `sentAt`, `acceptedAt`, `deniedAt`, `denialReason`, `denialNote`, `statusHistory`.

## Storm intelligence (`/api/v1/storm`)
| Endpoint | Permission | Notes |
|---|---|---|
| GET `/status` | stormEvents:read | thresholds, radii, geocoder, alert channel status, map tiles, sources, MRMS flag |
| GET `/search` | stormEvents:search | `address` or `lat`+`lng` or `propertyId`; `radius` 1/3/5/10; `from`, `to`, `types`, `minHail`, `minWind`, `sources`, `includeUnknownSpeed`, `dateOfLoss`, `state` (regional context), `sort`, `page`, `pageSize` |
| GET `/geocode` | stormEvents:search | `address` |
| GET `/events/map` | stormEvents:read | `bbox=w,s,e,n` or `lat,lng,radius`; same filters; capped, with `truncated` |
| GET `/events/:id` | stormEvents:read | one report with source, precision, narrative |
| GET `/history` | stormEvents:read | `propertyId`, `customerId`, `leadId` or `projectId` + `radius` |
| GET `/imports`; POST `/imports/backfill`, `/imports/spc`, `/imports/daily` | stormEvents:import | ingestion status and starts (202) |
| GET/POST `/zones`, GET/PATCH/DELETE `/zones/:id`, GET `/zones/rankings`, POST `/zones/:id/assign` | read: stormZones:read; write: stormZones:manage | |
| GET/POST/PATCH/DELETE `/alerts/rules[/:id]` | stormAlerts:manage | |
| GET `/alerts/history`, GET `/alerts/channels` | stormAlerts:read | |
| POST `/alerts/evaluate-recent` | stormAlerts:manage | re-check the last 3 days (duplicates are skipped) |
| GET `/follow-ups`; POST `/follow-ups/:id/review`, `/dismiss`, `/activities` | stormEvents:read / activities:create | |
| POST `/follow-ups/scan` | stormZones:manage | |
