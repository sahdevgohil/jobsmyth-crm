# Legacy Roofing CRM — Product Requirements Document (PRD)

| Field | Value |
|---|---|
| Document | `docs/PRD.md` |
| Version | 0.1 — Draft for client review |
| Date | 2026-11-04 |
| Client | Legacy Construction Group (Texas, USA) |
| Related | [PROJECT.md](./PROJECT.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [TECH_STACK.md](./TECH_STACK.md) · [CURSOR_RULES.md](./CURSOR_RULES.md) · [DECISIONS.md](./DECISIONS.md) |

---

## 0. How to Read This Document

**Source labels.** Every requirement carries one label:

- **[C] Confirmed** — stated by the client or contained in the approved project brief.
- **[P] Proposed** — a recommended default written by the documentation team. It is the working default for implementation, but it must not be described to the client as agreed. Each [P] item is either self-explanatory or linked to an open question (`Q-NNN`) in [DECISIONS.md](./DECISIONS.md).

**Requirement IDs.** Format `PREFIX-NNN`. IDs are permanent: never renumber; mark deprecated requirements as `(Deprecated)` instead of deleting or reusing them. Commits, branches and tests reference these IDs.

| Prefix | Module |
|---|---|
| AUTH | 1. Authentication and User Management |
| DASH | 2. Dashboard |
| LEAD | 3. Lead Management and Pipeline |
| CUST | 4. Customer and Property Management |
| APPT | 5. Appointment Management |
| MEAS | 6. Roof Measurement Integration |
| INSP | 7. Photos and Inspections |
| RPT | 8. Photo Reports |
| EST | 9. Estimates and Proposals |
| MAT | 10. Material Management |
| PROJ | 11. Project Management |
| PAY | 12. Invoices and Payments |
| ACCT | 13. Accounting Integration |
| COMM | 14. Communication |
| PORT | 15. Customer Portal |
| AS | 16. After-Sales Management |
| ANL | 17. Reports and Analytics |
| SET | Cross-cutting: settings and configuration |
| AUD | Cross-cutting: audit trail |
| MIG | Proposed: CSV import of existing data (pending client approval) |
| BR | Business rules |
| NFR | Non-functional requirements |
| SEC | Security requirements |

**Phase.** Each module lists the delivery phase defined in [PROJECT.md](./PROJECT.md) §7.

---

## 1. Product Overview

Legacy Roofing CRM is a centralized, web-based CRM and business management system for Legacy Construction Group. It covers the full customer lifecycle: lead capture, assignment and pipeline, customers and properties, appointments, inspections and photo documentation, roof measurements, estimates and proposals with digital signature, material ordering, project execution with subcontractors, invoicing and payments, accounting synchronization, customer communication, a customer portal, warranties and after-sales follow-up, and reporting.

The system is built for one company (single organization). It is designed as a modular monolith so that it stays maintainable and could later be evolved toward a commercial product, but **multi-tenant SaaS capabilities are explicitly out of scope** (see §12).

## 2. Business Problem

Legacy Construction Group currently runs its operations with Excel and manual processes [C]. This causes:

- **Duplicate data entry** — the same customer, address and job details are re-typed into spreadsheets, Roofr, estimates and invoices.
- **No single source of truth** — leads, measurements, photos, estimates and payments live in separate places.
- **Manual lead handling** — website inquiries are not automatically captured or assigned [C].
- **Limited visibility** — no live view of pipeline, pending estimates, active projects, outstanding payments or salesperson performance.
- **Manual invoicing** — invoices, including the 50% advance [C], are produced by hand.

## 3. Product Goals

| ID | Goal | How it is verified |
|---|---|---|
| G-1 | Capture every lead in one system | Website inquiries appear in the CRM automatically (LEAD-003); door-knock, referral and phone leads are entered in under 1 minute on mobile. |
| G-2 | Assign leads without manual triage | Website leads are auto-assigned per the configured rule (LEAD-005). |
| G-3 | Eliminate re-entry from measurement to invoice | Measurement data populates estimates (EST-005); approved estimates generate material lists (MAT-005) and invoices (PAY-003). |
| G-4 | Centralize field documentation | Photos, inspections and reports are attached to the correct customer/property/project (BR-11). |
| G-5 | Know where money stands | Balances are calculated from invoice and payment records (BR-15); outstanding invoices are listed with aging (PAY-011). |
| G-6 | Give management live insight | Dashboard and reports are calculated from real records with filters (DASH, ANL). |
| G-7 | Give customers self-service access | Customers view and sign proposals, view reports and invoices, and pay online where enabled (PORT). |

Numerical business targets (for example, conversion-rate improvements) have not been provided by the client and are not invented here.

## 4. User Personas

| Persona | Description | Primary device | Key needs |
|---|---|---|---|
| **Administrator** (1 user — provisional baseline, final confirmation Q-001) | Office administrator; manages users, settings, pricing, invoices, payments and reporting. | Desktop | Full visibility, configuration, financial accuracy, error visibility for integrations. |
| **Salesperson** (5 users — provisional baseline, final confirmation Q-001) | Manages customers from first contact through project completion [C]; door knocks, inspects roofs, photographs damage, presents estimates. | Mobile browser in the field, desktop in office | Fast lead entry, calendar, photo upload from phone, measurement-based estimates, status of their jobs. |
| **Customer** (portal) | Residential or commercial property owner/representative. | Mobile or desktop | See project progress, review/sign proposals, view reports, view and pay invoices, see warranties. |
| **Subcontractor** (no login in scope [P], Q-015) | Performs project work. | — | Receives work orders (PDF/email). |

Residential and commercial work is handled by the same team [C]; there are no separate residential/commercial roles.

## 5. User Roles and Permissions

Initial roles [C]: **Admin**, **Salesperson**. Customers authenticate separately as **portal accounts** (not internal users) [P, D-008].

Data scope for salespeople is an open question (Q-003). Working default [P]: a salesperson sees and edits records **assigned to them** (leads, customers they own, projects they are assigned to, and records belonging to those), and can search all customers by name/phone/address for duplicate prevention without opening unrelated records' financial details.

| Capability | Admin | Salesperson |
|---|---|---|
| Manage users and roles | ✅ | ❌ |
| Company settings, pipeline stages, lookup lists, tax rates, payment-schedule templates | ✅ | ❌ |
| Catalog, suppliers, estimate templates | ✅ | View only [P] |
| Leads: create / edit / stage / notes | ✅ all | ✅ own |
| Leads: reassign | ✅ | ❌ [P] |
| Lead conversion | ✅ | ✅ own |
| Customers & properties | ✅ all | ✅ own |
| Appointments | ✅ all | ✅ own |
| Inspections, photos, photo reports | ✅ all | ✅ own |
| Measurements: request / manual import | ✅ | ✅ own |
| Estimates: create, edit draft, send | ✅ | ✅ own |
| Estimates: override price/margin | ✅ | ⚠️ Q-010 (default [P]: allowed on own estimates, logged in audit trail) |
| Estimates: record manual approval (`recorded_manual`) | ✅ | ❌ [P] |
| Material orders | ✅ | ✅ own projects [P] |
| Projects, tasks, work orders, subcontractor assignment | ✅ | ✅ own |
| Subcontractor directory edit | ✅ | View only [P] |
| Invoices: issue, void | ✅ | ❌ [P] (view own) |
| Payments: record manual payment | ✅ | ❌ [P] (view own) |
| QuickBooks connection and sync retry | ✅ | ❌ |
| Messages (email/SMS) to customers | ✅ | ✅ own |
| Message templates | ✅ | ❌ |
| Portal account invite/disable | ✅ | ✅ own customers [P] |
| Warranties, feedback, review requests | ✅ | ✅ own |
| Dashboard & reports | ✅ all incl. salesperson performance | ✅ own data only |
| Audit log | ✅ | ❌ |

All permissions are enforced on the backend (SEC-004). Hiding UI is a convenience, not a control.

---

## 6. Functional Requirements by Module

### 6.1 Module 1 — Authentication and User Management (Phase 1)

| ID | Requirement | Src |
|---|---|---|
| AUTH-001 | Internal users sign in with email and password and can sign out. Sign-out revokes the current session's refresh token. | C |
| AUTH-002 | Passwords are hashed with Argon2id. Plaintext passwords are never stored, logged or returned. | C |
| AUTH-003 | Sessions use a short-lived JWT access token plus a rotating refresh token in an httpOnly, Secure cookie, as specified in ARCHITECTURE §7. | C |
| AUTH-004 | Each user has exactly one role (`admin` or `salesperson`). Permissions are defined in one central permission map; adding a role must not require a database migration. | C |
| AUTH-005 | Admin can create, edit and deactivate users and change roles. Users are deactivated, never hard-deleted, so historical records keep their owner. | C/P |
| AUTH-006 | Deactivating a user or changing their role revokes all of that user's refresh sessions immediately. | P |
| AUTH-007 | Initial onboarding without an email provider: admin sets a temporary password; the user must change it at first sign-in. Once email is configured, invite and reset links replace this (AUTH-008). | P |
| AUTH-008 | Password reset and invites use single-use, hashed, expiring tokens (reset: 1 hour; invite: 72 hours) delivered by email. Responses never reveal whether an email exists. | P |
| AUTH-009 | Password policy: 12–128 characters. No composition rules. | P |
| AUTH-010 | Login, refresh, password-reset and invite endpoints are rate-limited (SEC-006). | C |
| AUTH-011 | All non-public frontend routes redirect unauthenticated users to the login page and restore the intended route after login. | C |
| AUTH-012 | All non-public API endpoints require authentication and an explicit permission check. | C |
| AUTH-013 | `GET /auth/me` returns the current user, role and permission list so the frontend can adapt the UI. | P |
| AUTH-014 | Users can change their own password (requires current password); this revokes their other sessions. | P |

**Acceptance criteria**

- AC-AUTH-1: A deactivated user cannot sign in, and an active session of that user fails on its next refresh.
- AC-AUTH-2: A salesperson calling an admin-only endpoint receives `403` with a safe error body; the attempt is logged.
- AC-AUTH-3: Reusing an already-rotated refresh token revokes the whole token family and returns `401`.
- AC-AUTH-4: Password hashes in the database use the Argon2id format; no endpoint response contains `passwordHash`.
- AC-AUTH-5: Ten failed logins within the rate-limit window from one IP produce `429`.

### 6.2 Module 2 — Dashboard (Phase 2, extended in each later phase)

| ID | Requirement | Src |
|---|---|---|
| DASH-001 | Every dashboard figure is calculated from live database records. No hardcoded or sample numbers in production code. | C |
| DASH-002 | A tile is shown only when the module that produces its data has been implemented. Unbuilt modules show no tile (not a zero, not a placeholder number). | P |
| DASH-003 | Admin sees company-wide figures and salesperson performance; salesperson sees figures for their own records only. | C/P |
| DASH-004 | Date-range filter (default: current month) applies to period metrics; snapshot metrics (e.g., active leads) show current state. | P |
| DASH-005 | Each tile links to the corresponding filtered list. | P |
| DASH-006 | Dashboard data is served by one aggregated endpoint and loads within 2 seconds (p95) at expected data volumes (NFR-003). | P |

**Metric definitions** [P — confirm with client, Q-024, Q-030]

| Metric | Definition |
|---|---|
| Total leads | Leads created in the selected period. |
| New leads | Leads currently in the first pipeline stage (category `open`, order = 1). |
| Active leads | Leads currently in any stage with category `open`. |
| Converted leads | Leads converted to customers in the selected period. |
| Total customers | Count of non-archived customers (snapshot). |
| Upcoming appointments | Appointments with status `scheduled` starting in the next 7 days. |
| Active projects | Projects in a stage with category `production`. |
| Pending estimates | Latest estimate revisions with status `sent`. |
| Total revenue | Sum of succeeded payments minus refunds in the period (cash basis). Invoiced and contracted totals shown as secondary figures. |
| Pending payments | Sum of balance due on issued, non-void invoices (snapshot). |
| Recent activities | 20 most recent activity entries within the user's scope. |
| Salesperson performance (admin) | Per salesperson for the period: leads assigned, leads converted, conversion rate, estimates sent, estimates approved, contracted value, collected revenue. |

**Acceptance criteria**

- AC-DASH-1: With a seeded test dataset, each tile equals the value computed by an independent test query.
- AC-DASH-2: A salesperson's dashboard excludes all records not in their scope.
- AC-DASH-3: Searching the frontend and backend source code finds no hardcoded metric values.

### 6.3 Module 3 — Lead Management and Pipeline (Phase 2)

| ID | Requirement | Src |
|---|---|---|
| LEAD-001 | Users create leads manually. Required: first name or company name, and at least one of phone or email. Optional: last name, address, service interest, notes. | C/P |
| LEAD-002 | Each lead has a required source from a configurable list. Initial values: Door knocking, Word of mouth, Website, Phone call, Other [C]. | C |
| LEAD-003 | Website inquiries enter the CRM automatically through a public intake endpoint, with source `Website`, protected per SEC-010. The exact mechanism depends on the website platform (Q-006). | C |
| LEAD-004 | Phone-call leads are captured by manual entry with source `Phone call`. No telephony integration. | C |
| LEAD-005 | Leads are auto-assigned to salespeople. Working default rule: round-robin among active salespeople flagged "receives leads", skipping deactivated users (Q-002). Leads created by a salesperson are assigned to that salesperson. Admin can reassign at any time; each assignment is logged. | C/P |
| LEAD-006 | Pipeline stages are configurable by Admin without code changes: create, rename, reorder, deactivate. Each stage has a category: `open`, `won`, or `lost`. A stage in use cannot be deleted, only deactivated. Exactly one `won` stage is used for conversion. | C/P |
| LEAD-007 | Initial stage list is seeded as a proposal (Q-005): New, Contacted, Appointment Set, Inspected, Estimate Sent, Won (won), Lost (lost). | P |
| LEAD-008 | Every stage change is recorded as an activity with previous stage, new stage, user and time. | C |
| LEAD-009 | Moving a lead to a `lost` stage requires a lost reason from a configurable list. | P |
| LEAD-010 | Follow-ups: users create follow-up tasks on a lead with due date/time and assignee, and mark them complete. Overdue follow-ups are highlighted in the lead list and the assignee's dashboard. No automated reminders are sent. | C/P |
| LEAD-011 | Notes and activities (note, call log, follow-up, stage change, assignment, conversion) appear on a chronological lead timeline. | C |
| LEAD-012 | Lead conversion creates a new customer (or links to an existing customer chosen by the user), creates a property from the lead address when present, sets the lead to the `won` stage, and stores `convertedCustomerId`. Conversion runs in a database transaction and is idempotent. | C |
| LEAD-013 | Duplicate detection runs on manual and website lead creation, comparing normalized phone (E.164), lowercase email and normalized street address + ZIP against existing leads and customers. Manual entry: matches are shown and the user chooses to open the existing record or continue. Website intake: the lead is created and flagged `possibleDuplicateOf`; the assignee is notified. Records are never auto-merged. | C/P |
| LEAD-014 | Lead list with filters (stage, source, assignee, created date, has overdue follow-up) and search (name, phone, email, address), server-side pagination. | P |
| LEAD-015 | Pipeline (kanban) view showing open stages; drag-and-drop changes stage and is subject to the same validation as LEAD-009. | P |
| LEAD-016 | A lead may record `referredByCustomerId` (used for referral tracking, AS-006) and a service interest from the project-category list. | P |

**Acceptance criteria**

- AC-LEAD-1: A submission to the website intake endpoint creates exactly one lead with source `Website`, assigned per the rule, and creates a notification for the assignee. Re-sending the same submission ID does not create a second lead.
- AC-LEAD-2: Creating a lead with a phone number that matches an existing customer in a different format (e.g., `(512) 555-0100` vs `+15125550100`) shows the match.
- AC-LEAD-3: Adding a new stage in settings makes it available in the pipeline without a deployment.
- AC-LEAD-4: Converting a lead twice (double click, retried request) creates exactly one customer.
- AC-LEAD-5: A salesperson cannot read or update a lead assigned to another salesperson (`404` per SEC-005).

### 6.4 Module 4 — Customer and Property Management (Phase 2)

| ID | Requirement | Src |
|---|---|---|
| CUST-001 | Customer fields: type (`individual` or `business`, Q-028), first and last name or company name, primary email, primary phone, additional contacts (name, role, phone, email), mailing address, owner salesperson, notes. | C/P |
| CUST-002 | Property fields: address line 1, address line 2, city, state, ZIP, property type (configurable list: e.g., single-family, multi-family, commercial), optional structured details (stories, approximate roof age, notes). Latitude/longitude stored when a maps provider is configured. | C/P |
| CUST-003 | One customer can own multiple properties; each property belongs to exactly one customer. Transferring a property between customers is out of scope. | C/P |
| CUST-004 | The customer detail page shows related leads, properties, projects, estimates, invoices, appointments, files and the communication history. | C |
| CUST-005 | The property detail page shows its projects, inspections, measurements, photos and reports. | P |
| CUST-006 | Communication history combines notes, logged calls, emails and SMS for the customer in one timeline (data from COMM once built). | C |
| CUST-007 | Duplicate detection (as LEAD-013) applies when creating customers directly. | P |
| CUST-008 | Customers with related records are archived, not deleted. Admin may hard-delete only customers with no related records. | P |
| CUST-009 | Address autocomplete and geocoding are used when a maps provider is configured; manual address entry always works without it. | P |

**Acceptance criteria**

- AC-CUST-1: A customer with two properties, each with a project, shows both properties and both projects on the customer page.
- AC-CUST-2: Archiving a customer hides them from default lists but keeps all related projects and invoices accessible to Admin.
- AC-CUST-3: Address entry succeeds when the maps API key is absent.

### 6.5 Module 5 — Appointment Management (Phase 3)

| ID | Requirement | Src |
|---|---|---|
| APPT-001 | Schedule an appointment linked to a lead or a customer, optionally a property and project. Fields: type, start, end, location (defaults to property/lead address), assigned salesperson, notes. | C |
| APPT-002 | Appointment types are a configurable list. Proposed initial values: Inspection, Sales consultation, Estimate presentation, Production walkthrough, Other. | C/P |
| APPT-003 | Statuses: `scheduled`, `completed`, `cancelled`, `no_show`. Cancellation requires a reason. | C/P |
| APPT-004 | Rescheduling changes date/time and records the previous date/time in the activity timeline. | C |
| APPT-005 | Calendar view with day, week and month views and a salesperson filter (Admin: all; salesperson: own). A list view is available on mobile. | C |
| APPT-006 | Overlapping appointments for the same salesperson produce a warning, not a block. | P |
| APPT-007 | Automated SMS/email appointment reminders are **not** implemented. | C |
| APPT-008 | Times are stored in UTC and shown in the company time zone (default `America/Chicago`, Q-029). | P |

**Acceptance criteria**

- AC-APPT-1: An appointment created for 9:00 AM Central displays as 9:00 AM in the calendar regardless of the viewer's browser time zone.
- AC-APPT-2: No email or SMS is sent when an appointment is created, changed or approaching.

### 6.6 Module 6 — Roof Measurement Integration (Phase 4)

**Context.** The client currently uses Roofr [C]. Provider research (DECISIONS.md §5, INT-01) found no verifiable public Roofr API, while EagleView and HOVER publish developer documentation and GAF QuickMeasure appears to be offered through partner platforms. No provider is validated yet. The module therefore contains two distinct capabilities:

1. **Manual measurement data import** (MEAS-005) — committed for Phase 4. A user enters the values from an existing provider report (e.g., a Roofr PDF). This is data entry, not a provider integration.
2. **External measurement provider API integration** (MEAS-002–MEAS-004, MEAS-008) — conditional. It is built only after a specific provider's API access has been validated against a real authorized account (MEAS-009, D-015). No API integration is promised until then.

Both capabilities store data in the same provider-independent format (MEAS-001), so estimates work the same way regardless of source.

| ID | Requirement | Src |
|---|---|---|
| MEAS-001 | Measurements are stored in a provider-independent format and attached to a property and a project. A project can have multiple measurement versions (BR-4). | C |
| MEAS-002 | **Conditional — external provider API only, after validation (MEAS-009).** Request workflow: select customer/property/project → choose provider and product options exposed by that provider → submit → measurement created with status `requested` and the provider order reference. | C |
| MEAS-003 | Status tracking: `requested`, `in_progress`, `completed`, `failed`, `cancelled`. Updated by provider webhook if available, otherwise by a polling job with backoff. | C |
| MEAS-004 | On completion: store normalized data (table below), store the provider PDF in object storage, and store the raw provider payload for traceability. | C |
| MEAS-005 | **Manual measurement data import (committed; not a provider integration):** a user uploads a provider report PDF (e.g., a Roofr report) and enters the normalized values in a validated form. The record has `source = manual_import`, and the UI labels it as manually entered. | C |
| MEAS-006 | Measurement history lists all versions per project. One version is marked "current" for new estimates. Estimates snapshot the values they used, so later versions never change existing estimates. | C/P |
| MEAS-007 | Editing values of a completed measurement creates a new version; existing versions are immutable. | P |
| MEAS-008 | Provider errors are logged with context, shown to the user as a safe message, and can be retried. | C |
| MEAS-009 | A provider adapter is enabled only after validation against a real authorized account and recorded in DECISIONS.md. No mock or simulated provider data in production code. | C |
| MEAS-010 | Measurement data is available to the estimate module (EST-005). | C |
| MEAS-011 | Measurement sections are optional for non-roofing project categories. | P |

**Normalized measurement fields**

| Field | Unit | Required for manual import |
|---|---|---|
| `totalAreaSqFt` | sq ft | Yes |
| `roofSquares` | squares (area ÷ 100) | Derived |
| `predominantPitch` | rise per 12 (e.g., `6/12`) | Yes |
| `pitchBreakdown[]` | pitch + area sq ft | No |
| `facetCount` | count | No |
| `ridgeFt`, `hipFt`, `valleyFt`, `eaveFt`, `rakeFt` | linear ft | Yes (0 allowed) |
| `flashingFt`, `stepFlashingFt` | linear ft | No |
| `wasteTable[]` | waste % → area sq ft, squares | No |
| `suggestedWastePercent` | % | No |
| `structures[]` | name + per-structure values | No |
| `providerReportFileId` | file reference | Yes (PDF) |

**Excluded here:** automated roof recognition, drone measurement, and an in-house replacement for Roofr. A manual roof tracing and calculation tool is recorded as future enhancement FE-01 (DECISIONS.md §3).

**Acceptance criteria**

- AC-MEAS-1: A manual import with a PDF and valid values creates a `completed` measurement version visible in project history and selectable in estimates.
- AC-MEAS-2: A manual import with a negative length or a non-PDF file is rejected with field-level errors.
- AC-MEAS-3: Creating version 2 does not change totals of an estimate created from version 1.
- AC-MEAS-4: Before a provider is validated, the request-from-provider action is not offered in the UI.

### 6.7 Module 7 — Photos and Inspections (Phase 3)

| ID | Requirement | Src |
|---|---|---|
| INSP-001 | Create an inspection for a property, optionally linked to a project. Fields: date, inspector (user), status (`draft`, `completed`), notes, optional checklist notes per area. | C |
| INSP-002 | Upload multiple photos from desktop and mobile browsers, including direct camera capture on mobile. | C |
| INSP-003 | Allowed photo types: JPEG, PNG, WebP; HEIC subject to the conversion spike (R-08). Maximum 20 MB per photo [P]. Rejected files show a clear reason. | C/P |
| INSP-004 | Photo metadata: upload time (server), capture time (from EXIF when present), GPS coordinates (from device geolocation when the user grants permission, otherwise from EXIF when present), uploader. Missing GPS never blocks upload. | C |
| INSP-005 | Categorization: one category and multiple tags per photo from configurable lists — roof slope/elevation (e.g., Front, Rear, Left, Right, North slope…) and damage type (e.g., Hail, Wind, Missing shingles, Leak, Wear). | C |
| INSP-006 | Captions per photo. | P |
| INSP-007 | Annotations: arrow, rectangle, ellipse, freehand line and text label, with color. Annotations are stored as an overlay; the original image is never modified. | C |
| INSP-008 | Photos are organized and filterable by property, inspection, project, category, tag and project phase (`before`, `during`, `after`). | C |
| INSP-009 | Thumbnails are generated for galleries. | P |
| INSP-010 | Deleting a photo is a soft delete recorded in the audit trail. | P |
| INSP-011 | Photo access follows the permissions of the parent record; images are served via short-lived signed URLs only. | C |
| INSP-012 | Image binaries are stored in object storage, never in MongoDB. | C |

**Acceptance criteria**

- AC-INSP-1: On iOS Safari and Android Chrome, a salesperson can capture and upload 10 photos to an inspection, and each appears with a thumbnail.
- AC-INSP-2: Denying location permission still allows upload; GPS is stored as absent, not as `0,0`.
- AC-INSP-3: A 30 MB file or a `.exe` renamed to `.jpg` is rejected (content check, not extension only).
- AC-INSP-4: A user without access to the property receives `404` for its photo list and cannot obtain a signed URL.

### 6.8 Module 8 — Photo Reports (Phase 3)

| ID | Requirement | Src |
|---|---|---|
| RPT-001 | Generate a branded PDF inspection report containing: company branding from settings (logo, name, contact, license text), customer name, property address and details, inspection date and inspector, inspection notes, and selected photos with category, tags, captions and annotations rendered. | C |
| RPT-002 | The user selects photos and their order; the default is all inspection photos grouped by category. | P |
| RPT-003 | Generation runs as a background job with status `queued`, `generating`, `ready`, `failed`. | P |
| RPT-004 | The generated PDF is stored as a file linked to the inspection, property and project. Regenerating creates a new version and keeps old ones. | C |
| RPT-005 | Sharing: (a) mark a report as visible in the customer portal; (b) once email is configured, send an email containing a portal link or an expiring signed download link. | C/P |
| RPT-006 | A report with 50 photos generates within 60 seconds. | P |

**Acceptance criteria**

- AC-RPT-1: The PDF shows annotations at the same positions as in the app.
- AC-RPT-2: A report marked as shared appears in the correct customer's portal and in no other customer's portal.

### 6.9 Module 9 — Estimates and Proposals (Phase 4 engine, Phase 5 module)

| ID | Requirement | Src |
|---|---|---|
| EST-001 | An estimate belongs to a project. Number format `EST-YYYY-NNNN` [P]; each revision increments `revision` under the same number. | C/P |
| EST-002 | Create an estimate from an estimate template or blank. Templates (Admin-managed) predefine options and line items. | C |
| EST-003 | An estimate contains 1–3 options. Default labels: Good, Better, Best (editable). Each option has its own line items and totals. | C |
| EST-004 | Line item fields: catalog item reference with snapshot (name, unit, kind, unit cost), quantity, quantity source (measurement basis or manual), apply-waste flag, unit cost, margin, unit price, taxable flag, description. | C |
| EST-005 | When a measurement version is selected, quantities for measurement-based catalog items are calculated automatically (ARCHITECTURE §11). | C |
| EST-006 | Authorized users can override quantity and unit price. Overrides are flagged, the calculated value is kept for reference, and the change is audited. | C |
| EST-007 | Waste factor: default from the measurement's suggested waste or company settings; editable per option. | C |
| EST-008 | Additional charges (e.g., permits, disposal, steep-pitch or extra-layer charges) are fee lines from the catalog or ad-hoc. | C |
| EST-009 | Discounts at option level: percentage or fixed amount, not exceeding the option subtotal, with optional reason. | C |
| EST-010 | Tax: configurable tax rates applied to taxable lines. Default rate is 0% until the client's accountant confirms treatment (Q-009). | C/P |
| EST-011 | Margin: default from settings, overridable per line. Unit price = unit cost ÷ (1 − margin) (margin convention, Q-010). Margin and cost are visible only to internal users. | C/P |
| EST-012 | All totals are calculated by the backend calculation service. The frontend displays backend results and never recalculates authoritative totals. | P |
| EST-013 | Statuses: `draft`, `sent`, `approved`, `declined`, `expired`, `superseded`. | P |
| EST-014 | Changing a `sent` or `approved` estimate creates a new draft revision. Previous revisions are read-only. When a new revision is approved, the previously approved revision becomes `superseded` (BR-14). | C |
| EST-015 | Approval records: approver (customer name/email or admin user), timestamp, method (`e_signature`, `portal_acceptance`, `recorded_manual`), selected option, signed document file, IP address where available. `recorded_manual` means an Admin manually records an approval from a customer-signed paper or PDF document and attaches that document; it has nothing to do with offline application functionality (which is excluded). | C |
| EST-016 | Customer-facing proposal PDF: branded, shows options with descriptions and prices, terms, expiry date and signature area; never shows cost, margin or internal notes. | C |
| EST-017 | Digital signature through the approved signature provider (INT-05); provider webhooks update status and the signed PDF is stored. Until a provider is validated, only `recorded_manual` approval is available (D-016). | C |
| EST-018 | Default expiry 30 days from sending, configurable [P]. A scheduled job marks expired estimates. | P |
| EST-019 | On approval: the project moves to the configured "sold" stage, the contract total is set from the approved option, a material list becomes available (MAT-005), and the payment schedule generates the advance invoice (PAY-003), for modules that are implemented. | C |
| EST-020 | No business prices, rates, margins or tax values are hardcoded; all come from catalog and settings records. | C |

**Acceptance criteria**

- AC-EST-1: Given a measurement of 2,500 sq ft, waste 10%, and a shingle item with 3 bundles per square, the quantity is `ceil(25 × 1.10 × 3) = 83` bundles.
- AC-EST-2: Calculation unit tests cover rounding, discounts exceeding subtotal (rejected), 0% and non-zero tax, margin overrides and manual quantity overrides.
- AC-EST-3: Editing an approved estimate creates revision n+1; revision n stays readable and unchanged.
- AC-EST-4: The customer proposal PDF contains no cost or margin values (automated test on rendered HTML).

### 6.10 Module 10 — Material Management (Phase 4 catalog basics, Phase 5 full)

| ID | Requirement | Src |
|---|---|---|
| MAT-001 | Catalog items: name, SKU, kind (`material`, `labor`, `fee`), category, unit (e.g., bundle, roll, piece, square, linear ft), unit cost, optional margin override, taxable, preferred supplier, active, and estimating rules: measurement basis, coverage per unit, apply waste, rounding mode. | C |
| MAT-002 | Material categories are a configurable list. | C |
| MAT-003 | Suppliers: name, contact person, phone, email, account number, address, notes, active. | C |
| MAT-004 | Price changes in the catalog never change existing estimates (line items are snapshots). | C |
| MAT-005 | A material list is generated from the approved estimate option: material lines aggregated by catalog item and grouped by preferred supplier; editable before ordering. | C |
| MAT-006 | Material orders: supplier, project, items (item, quantity, unit, unit cost), order date, expected delivery date, supplier reference number, status (`draft`, `ordered`, `partially_delivered`, `delivered`, `cancelled`), notes. | C |
| MAT-007 | Order history per project and per supplier. | C |
| MAT-008 | Printable material order PDF; email to supplier once email is configured. | P |
| MAT-009 | No supplier/distributor API integration until a specific API is validated (Q-023). | C |
| MAT-010 | Stock/inventory management is not included. "Quantities" refers to estimate and order quantities. | P |

**Acceptance criteria**

- AC-MAT-1: Approving an estimate with two options produces a material list only from the selected option.
- AC-MAT-2: Changing a catalog price after approval leaves the approved estimate and its material list unchanged.

### 6.11 Module 11 — Project Management (Phase 3 core record, Phase 6 full)

| ID | Requirement | Src |
|---|---|---|
| PROJ-001 | A project belongs to one customer and one property, has a category (configurable: e.g., Roofing, Gutters, Windows, Remodeling, Exterior repair, Interior repair, General construction, Commercial), name, assigned salesperson, stage and dates. | C |
| PROJ-002 | Project record timing (Q-025): a project is created when work is being scoped, so inspections, measurement versions and estimate revisions can attach to it (BR-3–5). Production work begins only after an estimate is approved, which moves the project into production stages. | P |
| PROJ-003 | Project stages are configurable with categories `pre_sale`, `production`, `completed`, `cancelled`. Proposed seed: Scoping, Estimating (pre_sale); Sold, Scheduled, In Progress, Final Inspection (production); Completed; Cancelled. | C/P |
| PROJ-004 | Assign multiple subcontractors per project, each with trade/role and notes. | C |
| PROJ-005 | Scheduling: planned start/end and actual start/end dates. | C |
| PROJ-006 | Tasks: title, description, assignee (user), due date, status (`open`, `done`). | C |
| PROJ-007 | Work orders: subcontractor, scope description, scheduled date, materials summary, site instructions, status (`draft`, `issued`, `in_progress`, `completed`, `cancelled`), printable PDF. | C |
| PROJ-008 | Notes, documents and photos tagged by phase `before`, `during`, `after`. | C |
| PROJ-009 | Completion checklist copied from the template for the project category. Items record who checked them and when. A project cannot move to `completed` while required items are unchecked. | C/P |
| PROJ-010 | Progress display: current production stage position and checklist completion (e.g., "Stage 3 of 4 · 7/10 checklist items"). | P |
| PROJ-011 | Project detail shows estimates, measurements, inspections, photos, material orders, work orders, invoices, payments and warranties. | C |
| PROJ-012 | Subcontractor directory: name, company, trades, phone, email, notes, active. No subcontractor login (Q-015). | C/P |

**Acceptance criteria**

- AC-PROJ-1: Attempting to complete a project with an unchecked required checklist item returns `422` with the list of missing items.
- AC-PROJ-2: A Gutters project works end-to-end without any measurement record.

### 6.12 Module 12 — Invoices and Payments (Phase 7)

| ID | Requirement | Src |
|---|---|---|
| PAY-001 | Each project has a payment schedule created from a configurable template. Default template: 50% advance before work starts [C]; remainder per agreed terms — proposed "50% on completion" (Q-008). | C/P |
| PAY-002 | Schedule items are percentage or fixed amount; they must total exactly the contract total. The last item absorbs rounding differences. | P |
| PAY-003 | Invoices are generated automatically when a schedule trigger occurs: `on_estimate_approval`, `on_project_start`, `on_project_completion`, or `manual`. Whether generated invoices are issued immediately or held as drafts for review is a setting (Q-011); default: draft. | C/P |
| PAY-004 | Admin can create manual invoices (e.g., additional work) with line items. | P |
| PAY-005 | Invoice numbers are sequential and unique, assigned when issued, never reused. Format `INV-YYYY-NNNNN` [P]; a starting number can be set (Q-011). | C/P |
| PAY-006 | Invoice content: company details, customer, property, project, line items, subtotal, discount, tax, total, amount paid, balance due, issue and due dates, payment terms, payment instructions. | C |
| PAY-007 | Issued invoices are immutable. Corrections are made by voiding and reissuing. An invoice with succeeded payments cannot be voided until those payments are refunded or reassigned by Admin. | P |
| PAY-008 | Manual payment records: amount, method (check, cash, bank transfer, card, ACH, other), date, reference (e.g., check number), note, recorded by. Partial payments allowed; payments exceeding the balance are rejected. | C/P |
| PAY-009 | Invoice paid amount and balance are recalculated by the service from payment records on every payment change, inside the same transaction (BR-15). | C |
| PAY-010 | A receipt PDF is generated for each succeeded payment. | C |
| PAY-011 | Outstanding payments view: issued invoices with balance > 0, filterable, with aging buckets (current, 1–30, 31–60, 61–90, 90+ days past due). | C |
| PAY-012 | Online card/ACH payment through Stripe once eligibility is confirmed (INT-02): Stripe-hosted payment UI; a payment is recorded as succeeded only from a verified Stripe webhook; ACH payments stay `pending` until Stripe confirms. | C |
| PAY-013 | Raw card or bank account numbers are never received, stored or logged by our servers. | C |
| PAY-014 | Contract total = approved option total of the current approved revision. If a later revision is approved, unpaid future schedule items are recalculated; issued invoices are not changed. | P |
| PAY-015 | Currency: USD only. | P |

**Acceptance criteria**

- AC-PAY-1: Contract total $10,000.01 with a 50/50 schedule produces an advance of $5,000.01 (50% rounded half-up) and a final item of $5,000.00 (total minus previous items), totalling exactly $10,000.01.
- AC-PAY-2: Two partial payments of $2,000 and $3,000 on a $5,000 invoice mark it `paid` with balance $0.
- AC-PAY-3: A forged Stripe webhook (bad signature) is rejected and records no payment.
- AC-PAY-4: Replaying a valid Stripe webhook event creates no duplicate payment.

### 6.13 Module 13 — Accounting Integration (Phase 7, gated)

| ID | Requirement | Src |
|---|---|---|
| ACCT-001 | Implementation starts only after the QuickBooks product is identified and API access is validated (Q-013). QuickBooks Desktop is not supported by the QuickBooks Online REST API; if the client uses Desktop, this module is re-scoped. | C |
| ACCT-002 | Admin connects QuickBooks Online via OAuth 2.0; tokens are stored encrypted (SEC-012). | P |
| ACCT-003 | Proposed sync scope: one-way push of customers, invoices and payments from CRM to QuickBooks. | P |
| ACCT-004 | A mapping record stores the external ID for each synced entity; re-sync updates the existing QuickBooks record instead of creating a duplicate. | C |
| ACCT-005 | Each sync attempt records status (`pending`, `synced`, `failed`), timestamp and error message; Admin can see failures and retry. | C |
| ACCT-006 | Sync runs in background jobs; failures never block CRM operations. | P |
| ACCT-007 | Item, tax and account mapping is configured with the client's accountant before go-live. | P |
| ACCT-008 | The integration is not reported as complete until tested against the client's authorized QuickBooks company (sandbox plus production verification). | C |

### 6.14 Module 14 — Communication (Phase 8; in-app notifications earlier)

| ID | Requirement | Src |
|---|---|---|
| COMM-001 | Unified communication history per lead/customer: emails, SMS, logged calls and notes. | C |
| COMM-002 | Send email to customers from the CRM through Resend (INT-03) using a verified sending domain. Each message is stored with status (`queued`, `sent`, `failed`, plus provider delivery events where available). | C |
| COMM-003 | Send SMS through Twilio (INT-04) only to numbers with recorded consent. STOP and other opt-out keywords are honored and block further sends; opt-in (START) is recorded. | C |
| COMM-004 | Inbound SMS replies are captured into the customer's thread via webhook. | P |
| COMM-005 | Inbound email capture is out of scope initially; outgoing emails set reply-to to the sending user. | P |
| COMM-006 | Message templates per channel with placeholders (e.g., `{{customer.firstName}}`, `{{project.name}}`), managed by Admin. Unknown placeholders fail validation. | C |
| COMM-007 | Customer project updates are messages tagged `project_update` and shown in the project timeline. | C |
| COMM-008 | In-app notifications for internal users: lead assigned, website lead received, possible duplicate, estimate signed/declined, payment received, measurement completed/failed, integration sync failure. Unread count shown. | C |
| COMM-009 | Consent records: contact, channel, status (`opted_in`, `opted_out`), source (web form, verbal, written, keyword), consent text shown, timestamp, recorded by. | C |
| COMM-010 | Initial scope is transactional/service messages only; marketing campaigns are out of scope. SMS compliance (A2P 10DLC registration, consent language) must be confirmed before enabling SMS (R-05). | P |
| COMM-011 | No simulated sending: if a provider is not configured, the send action is disabled and says why. | C |

### 6.15 Module 15 — Customer Portal (Phase 8)

| ID | Requirement | Src |
|---|---|---|
| PORT-001 | Portal accounts are linked to exactly one customer. Staff invite a contact by email; the contact sets a password through a single-use link. | C/P |
| PORT-002 | The portal shows only that customer's: projects and progress, estimates/proposals with status `sent` or later, reports marked shared, issued invoices and payments, warranties. | C |
| PORT-003 | Customers can review proposals, choose an option and sign through the signature provider (or portal acceptance if approved, D-016). | C |
| PORT-004 | Customers can pay issued invoices online when Stripe is enabled. | C |
| PORT-005 | Every portal query is scoped by the `customerId` from the portal token, never from request parameters. | C |
| PORT-006 | Costs, margins, internal notes, internal users' private data and other customers' data are never exposed. | C |
| PORT-007 | Staff can disable a portal account; disabling revokes its sessions. | P |
| PORT-008 | Business customers may have multiple portal accounts (one per contact), all scoped to the same customer. | P |

**Acceptance criteria**

- AC-PORT-1: Automated tests prove that customer A's token cannot read any of customer B's projects, estimates, files or invoices by changing IDs in URLs (`404`).
- AC-PORT-2: The portal proposal view and API response contain no cost or margin fields.

### 6.16 Module 16 — After-Sales Management (Phase 8)

| ID | Requirement | Src |
|---|---|---|
| AS-001 | Warranty records per project: type (configurable, e.g., Manufacturer, Workmanship), manufacturer/provider, registration number, start date, end date, coverage notes, documents. | C |
| AS-002 | Warranties are visible on the project, customer and portal. | C |
| AS-003 | List of warranties expiring in the next 90 days. | P |
| AS-004 | Customer feedback: rating 1–5, comments, source (staff entry, portal), date, linked project. | C |
| AS-005 | Review requests: send a templated email/SMS containing the configured review URL; record sent date and a manually set outcome (`review_received`, `no_response`). | C/P |
| AS-006 | Referral tracking: report of leads with `referredByCustomerId`, grouped by referring customer, with conversion status. | C |
| AS-007 | Project history across all of a customer's properties on the customer page. | C |

### 6.17 Module 17 — Reports and Analytics (Phase 8; selected reports earlier)

| ID | Requirement | Src |
|---|---|---|
| ANL-001 | All reports are computed from application records via backend aggregation. | C |
| ANL-002 | Common filters: date range, salesperson, project category, status. | C |
| ANL-003 | Lead conversion rate = leads created in period that are converted ÷ leads created in period (cohort method) [P]; breakdown by source and salesperson. | C/P |
| ANL-004 | Revenue: collected (payments − refunds), invoiced, contracted; by month. | C |
| ANL-005 | Revenue by salesperson (project's assigned salesperson). | C |
| ANL-006 | Average project value = mean contract total of projects approved in period. | C |
| ANL-007 | Average completion time = mean days from actual start to actual end for projects completed in period; also approval-to-completion. | C |
| ANL-008 | Pending estimates list with age. | C |
| ANL-009 | Active projects by stage. | C |
| ANL-010 | Outstanding invoices with aging (PAY-011). | C |
| ANL-011 | Payment collection: collected by period and method. | C |
| ANL-012 | Material costs: estimated material cost from approved estimates and recorded material-order costs where entered. | C |
| ANL-013 | CSV export of report tables. | P |
| ANL-014 | Salesperson users see only their own data in reports. | P |

### 6.18 Cross-Cutting — Settings (Phase 1, extended per module)

| ID | Requirement | Src |
|---|---|---|
| SET-001 | Company settings record: legal name, display name, logo, address, phone, email, website, license/registration text, time zone, default waste %, default margin, tax rates, estimate expiry days, invoice terms text, proposal terms text. (Branding assets: Q-022.) | C/P |
| SET-002 | Configurable lists ("lookups") managed by Admin: lead sources, lost reasons, property types, appointment types, photo categories, slope/elevation tags, damage-type tags, material categories, project categories, warranty types. | C/P |
| SET-003 | Lookup values in use are deactivated, never deleted. | P |
| SET-004 | Payment-schedule templates and checklist templates are Admin-managed. | C/P |

### 6.19 Cross-Cutting — Audit Trail (Phase 1, extended per module)

| ID | Requirement | Src |
|---|---|---|
| AUD-001 | Important business actions write an immutable audit entry: actor, action, entity type and ID, timestamp, summary of changed fields (before/after for key fields), request ID. | C |
| AUD-002 | Audited actions include at minimum: user/role changes, login failures, lead assignment and conversion, stage changes, estimate send/approve/revise, price/margin overrides, invoice issue/void, payment create/refund, file delete, settings changes, integration connect/disconnect. | C/P |
| AUD-003 | Financial audit entries are written in the same transaction as the change. | P |
| AUD-004 | Admin can view and filter the audit log. Audit entries cannot be edited or deleted through the application. | P |

### 6.20 Proposed — CSV Import of Existing Customer and Lead Data (pending client approval)

**Status:** proposed initial migration feature. It is **not part of the committed scope** and MUST NOT be implemented until the client approves it (Q-021, D-032, change request CR-01). If approved, it is planned for Phase 2 after LEAD and CUST are complete, because it reuses their validation and duplicate detection. The client exports existing Excel sheets as CSV; `.xlsx` files are not read directly.

| ID | Requirement | Src |
|---|---|---|
| MIG-001 | Admin-only import of **customers** (with optional property address) or **leads** from a UTF-8 CSV file with a header row. Limits: 5 MB and 5,000 rows per file. | P |
| MIG-002 | Field mapping: the system lists the file's columns; Admin maps each column to a CRM field or "Ignore". Columns whose header matches a field name are pre-selected. Required fields are marked, and mapping cannot be confirmed until they are mapped. | P |
| MIG-003 | Batch defaults: Admin selects default values for fields not present in the file (lead source, pipeline stage, assigned salesperson / customer owner). Mapped values must match existing lookup values, stages and users; unknown values are row errors and are never auto-created. | P |
| MIG-004 | Validation: every row is validated by the backend with the same schemas and normalization as manual creation (LEAD-001, CUST-001, CUST-002; phone E.164, email, address key). Errors are reported per row and field. | P |
| MIG-005 | Duplicate detection: the LEAD-013 rules are applied against existing leads and customers **and** between rows within the same file. | P |
| MIG-006 | Preview before any write: totals (rows, valid, invalid, possible duplicates) and row-level details. For each possible duplicate Admin chooses **Skip** (default) or **Import as new**. Existing records are never updated or merged by an import. Nothing is written to leads or customers during preview. | P |
| MIG-007 | Confirm: only valid, non-skipped rows are created, in batches. Each created record stores `importBatchId`, receives an "imported" timeline activity, and the batch is recorded in the audit trail. | P |
| MIG-008 | Result report: counts of created, skipped and rejected rows, plus a downloadable CSV of rejected rows with error reasons so they can be corrected and re-imported. | P |
| MIG-009 | Confirming the same batch more than once never creates records twice. | P |
| MIG-010 | Imported records follow normal scope rules. Auto-assignment (LEAD-005) runs only if Admin selects it for the batch; one summary notification is sent instead of one per record. | P |
| MIG-011 | Not imported: projects, estimates, invoices, payments, photos and files. Importing financial history would require a separate approval. | P |

**Acceptance criteria (apply only if approved)**

- AC-MIG-1: A file with one invalid phone number and one row duplicating an existing customer shows both in the preview, and no records exist until confirmation.
- AC-MIG-2: Two rows in the same file with the same phone number in different formats are flagged as duplicates of each other.
- AC-MIG-3: Retrying the confirm request creates no additional records.
- AC-MIG-4: A salesperson receives `403` on every import endpoint.

---

## 7. Key User Workflows

**W-1 Door-knock lead → appointment (mobile).** Salesperson opens "New lead" → enters name, phone, address, source *Door knocking* → duplicate check shows no match → lead saved, assigned to self → schedules an inspection appointment.

**W-2 Website inquiry.** Website form submits → intake endpoint validates and stores the lead (source *Website*) → duplicate check flags if needed → auto-assignment → in-app notification to the salesperson → salesperson calls and logs the call.

**W-3 Conversion and scoping.** Salesperson converts the lead → customer and property created → project created in *Scoping* stage → inspection created with photos and tags → photo report generated and shared.

**W-4 Measurement → estimate.** Salesperson imports the Roofr PDF and values (manual adapter) or requests a validated provider → measurement completed → estimate from template; quantities calculated; Good/Better/Best options adjusted → proposal sent for signature.

**W-5 Approval → production.** Customer signs → estimate `approved` → project moves to *Sold* → contract total set → payment schedule creates the 50% advance invoice (draft or issued per setting) → material list → material order → work orders to subcontractors.

**W-6 Payment.** Customer pays the advance in the portal (Stripe) or by check recorded by Admin → balance recalculated → receipt generated → sync to QuickBooks (if enabled).

**W-7 Completion and after-sales.** Checklist completed → project *Completed* → final invoice generated → payment → warranty recorded → review request sent → referral tracked on future leads.

---

## 8. Business Rules

| ID | Rule | Src |
|---|---|---|
| BR-1 | One customer can have multiple properties. | C |
| BR-2 | One property can have multiple projects. | C |
| BR-3 | One project can have multiple inspections. | C |
| BR-4 | One project can have multiple measurement versions. | C |
| BR-5 | One project can have multiple estimates and revisions. | C |
| BR-6 | One estimate can contain multiple material and labor line items (per option). | C |
| BR-7 | One project can have multiple invoices. | C |
| BR-8 | One invoice can have multiple payment records. | C |
| BR-9 | A project can involve multiple subcontractors. | C |
| BR-10 | A salesperson can manage multiple leads and projects. | C |
| BR-11 | Every uploaded file belongs to an explicit context (customer and, where applicable, property, project, inspection); the backend validates that the context exists and that the user may access it. | C |
| BR-12 | Measurement data feeds estimate calculations automatically when selected. | C |
| BR-13 | Estimate approvals are recorded with approver, method, time and selected option. | C |
| BR-14 | Changes to approved estimates create new revisions; approved revisions are never modified. | C |
| BR-15 | Invoice paid amounts and balances are derived from payment records, never entered directly. | C |
| BR-16 | Payment terms are configurable per project. | C |
| BR-17 | The default advance is 50% via the default template; it is not hardcoded and can differ per project. | C |
| BR-18 | Important business activities have an audit trail (AUD). | C |
| BR-19 | Inspections require a property; a lead must be converted before inspection records are created. Appointments may reference a lead. | P (Q-004) |
| BR-20 | Monetary values are USD stored in integer cents; percentages are stored in basis points. | P |
| BR-21 | Line items snapshot catalog values at the time they are added. | P |

**Rules requiring client confirmation:** BR-19 (Q-004), PROJ-002 project timing (Q-025), PAY-001 remaining terms (Q-008), EST-010 tax (Q-009), EST-011 margin convention (Q-010), LEAD-005 assignment (Q-002), §5 data scope (Q-003).

---

## 9. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-001 | Responsive UI. Field features (leads, appointments, customers, inspections, photo upload, measurements view) are fully usable at 360 px width. |
| NFR-002 | Supported browsers: latest two versions of Chrome, Edge, Firefox, Safari (macOS and iOS). |
| NFR-003 | Performance at expected volume (≈ 6 internal users + portal users; assumption: < 10,000 leads/year, < 200,000 photos total): API p95 < 500 ms for list/detail endpoints; dashboard < 2 s; photo upload limited only by network. |
| NFR-004 | Availability: hosted on managed services; no formal SLA defined (Q-027). |
| NFR-005 | Backups: MongoDB Atlas automated backups enabled; object storage versioning or replication evaluated; a restore test is performed before go-live. |
| NFR-006 | Accessibility: WCAG 2.1 AA fundamentals on core flows (labels, keyboard navigation, focus states, contrast). |
| NFR-007 | Observability: Sentry on frontend, API and worker; structured logs with request ID; integration calls logged with provider, operation, duration and outcome. Sentry is introduced when INT-10 is set up and no earlier than Phase 2 (TECH_STACK §14); until then, structured logs are used. |
| NFR-008 | Locale: `en-US`, USD, company time zone (default `America/Chicago`). |
| NFR-009 | Maintainability: lint, typecheck and tests run in CI and must pass before merge. |
| NFR-010 | Privacy: personal data is not written to logs beyond IDs; Sentry PII scrubbing enabled. |
| NFR-011 | Data retention and deletion policy to be confirmed (Q-026). |

## 10. Integrations

Status values: **Validated** (tested with real authorized account), **Pending validation**, **Deferred**. Details in DECISIONS.md §5.

| ID | Integration | Purpose | Status |
|---|---|---|---|
| INT-01 | Roof measurement provider (EagleView / HOVER / GAF QuickMeasure / Roofr) | MEAS | Pending validation — manual import adapter first |
| INT-02 | Stripe | Card/ACH payments | Pending validation |
| INT-03 | Resend | Transactional email | Pending validation |
| INT-04 | Twilio | SMS | Pending validation (10DLC registration required) |
| INT-05 | Dropbox Sign or DocuSign | E-signature | Pending selection and validation |
| INT-06 | QuickBooks Online | Accounting sync | Pending validation (product unknown) |
| INT-07 | Mapbox or Google Maps | Autocomplete, geocoding, map display | Pending selection |
| INT-08 | AWS S3 or Cloudflare R2 | File storage | Pending selection |
| INT-09 | Website form | Lead intake | Pending (website platform unknown) |
| INT-10 | Sentry | Monitoring | Pending account setup |
| INT-11 | Material supplier APIs | Ordering | Deferred |

## 11. Security Requirements

| ID | Requirement |
|---|---|
| SEC-001 | HTTPS everywhere; HSTS in production. |
| SEC-002 | Argon2id password hashing (AUTH-002). |
| SEC-003 | Access tokens short-lived (15 min) and kept in memory on the frontend; refresh tokens rotated, stored hashed, httpOnly + Secure + SameSite cookie scoped to the refresh path. |
| SEC-004 | Authorization enforced in backend middleware and services on every request; record-level scope enforced in queries. |
| SEC-005 | Records outside a user's scope return `404` (not `403`) to avoid revealing existence. |
| SEC-006 | Rate limiting on auth endpoints, public intake and webhooks. |
| SEC-007 | All request bodies, params and queries validated with Zod; unknown fields stripped; Mongo operator injection prevented. |
| SEC-008 | File uploads: allow-listed MIME types verified by content signature, size limits, server-generated object keys, private buckets, short-lived signed URLs. |
| SEC-009 | Secrets only in environment variables / secret manager; `.env` never committed; `.env.example` contains names only. |
| SEC-010 | Public lead intake: shared-secret authentication, honeypot/anti-spam field, payload size limit, rate limit, idempotency key. |
| SEC-011 | Webhooks verify provider signatures and are idempotent by provider event ID. |
| SEC-012 | Integration OAuth tokens encrypted at rest with an application key (AES-256-GCM). |
| SEC-013 | Security headers (Helmet), strict CORS allow-list, no stack traces in client responses. |
| SEC-014 | No raw card/bank data handled (PAY-013). |
| SEC-015 | Dependency vulnerability scanning in CI (`npm audit` or GitHub Dependabot). |
| SEC-016 | Portal and internal authentication are separate token audiences; a portal token is rejected by internal endpoints and vice versa. |

## 12. Out of Scope

Not implemented in this scope (may become future phases): native Android app; native iOS app; offline mode; offline sync; multi-tenant SaaS architecture and tenant onboarding; SaaS subscription billing; insurance claims management; Xactimate integration; ESX import/export; supplement management; RCV/ACV/depreciation calculations; mortgage check tracking; drone measurement; automated AI roof recognition; storm and hail intelligence platform.

Additionally not included unless later approved [P]: automated appointment reminders [C], telephony/call recording, inventory management, marketing campaigns, inbound email capture, subcontractor login, a manual roof tracing tool (FE-01), supplier API integrations, CSV import of existing Excel customer and lead data (§6.20, MIG — proposed, pending client approval, Q-021).

## 13. Global Acceptance Criteria

A requirement is accepted when:

1. Its module-level acceptance criteria pass.
2. Backend authorization and scope tests exist for its endpoints.
3. It works on mobile (if NFR-001 applies) and desktop.
4. Loading, empty, error and success states exist in the UI.
5. No mock data, fake responses or hardcoded business values exist in production code.
6. Audit entries are written where AUD-002 applies.
7. Documentation is updated per CURSOR_RULES.md §15.

## 14. Open Questions

The authoritative list is in [DECISIONS.md §4](./DECISIONS.md#4-unresolved-business-questions). Questions with the largest impact on requirements:

| Question | Affects |
|---|---|
| Q-001 Final confirmation of 6 internal users (5 salespeople + 1 admin) | Licensing/seat-based provider costs, seed data |
| Q-002 Lead assignment rule | LEAD-005 |
| Q-003 Salesperson data visibility | §5, all list endpoints |
| Q-004 / Q-025 Conversion and project timing | LEAD-012, PROJ-002, BR-19 |
| Q-007 Measurement provider | MEAS |
| Q-008 Payment terms after advance | PAY-001 |
| Q-009 Texas sales tax treatment | EST-010, PAY-006, ACCT-007 |
| Q-010 Margin vs markup, override authority | EST-006, EST-011 |
| Q-011 Invoice issuing and numbering | PAY-003, PAY-005 |
| Q-013 QuickBooks product | ACCT |
| Q-014 E-signature provider | EST-017, PORT-003 |
| Q-021 Approval of CSV import of existing customer/lead data | MIG-001–MIG-011, project scope |
