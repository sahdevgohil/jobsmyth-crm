# Legacy Roofing CRM — Decisions, Questions and Dependencies

| Field | Value |
|---|---|
| Document | `docs/DECISIONS.md` |
| Version | 0.1 |
| Date | 2026-11-04 |
| Related | [PRD.md](./PRD.md) · [PROJECT.md](./PROJECT.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) |

This is the single register for decisions, assumptions, open questions and integration status. **Nothing in this file marked "Proposed", "Assumption" or "Open" is confirmed.** When an item is confirmed, change its status, add the date and who confirmed it, and update the affected documents.

Status values: **Confirmed** (client or approved brief) · **Proposed** (recommended, awaiting approval; working default) · **Open** (decision needed) · **Rejected** · **Superseded**.

---

## 1. Confirmed Business Decisions

Source for all items: client brief (2026-11-04) unless stated.

| ID | Decision |
|---|---|
| CB-01 | Single company deployment for Legacy Construction Group; no multi-tenant SaaS, tenant onboarding or SaaS billing in this scope. |
| CB-02 | Internal roles: Admin and Salesperson. |
| CB-03 | Provisional initial user count confirmed as six internal users: five salespeople and one administrator. Final client confirmation still pending (Q-001), because the client initially said "five employees". |
| CB-04 | Lead sources: door knocking, word of mouth, website, phone call (manual entry), other. |
| CB-05 | Website inquiries must automatically enter the CRM. |
| CB-06 | Leads are automatically assigned to salespeople (rule open, Q-002). |
| CB-07 | Salespeople manage customers from initial inquiry through project completion. |
| CB-08 | Residential and commercial work share one team; no separate teams or roles. |
| CB-09 | Work is performed with subcontractors. |
| CB-10 | Automatic appointment reminders are not required now. |
| CB-11 | Customers pay a 50% advance before work starts; payment terms must be configurable per project. |
| CB-12 | The CRM generates invoices automatically. |
| CB-13 | Roofr is the current measurement software. |
| CB-14 | Excluded features: native Android/iOS apps, offline mode and sync, multi-tenant SaaS and onboarding, SaaS billing, insurance claims, Xactimate, ESX import/export, supplements, RCV/ACV/depreciation, mortgage check tracking, drone measurement, AI roof recognition, storm/hail intelligence. |
| CB-15 | Project categories beyond roofing must be supported. |
| CB-16 | Native mobile and offline are excluded; the web app must be responsive for mobile photo upload. |

## 2. Technology Decisions

### 2.1 Confirmed (approved stack in the brief)

| ID | Decision |
|---|---|
| CT-01 | Frontend: React, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router, TanStack Query, Zustand, React Hook Form, Zod, Lucide React. |
| CT-02 | Backend: Node.js, Express, TypeScript, REST, Mongoose, Zod, JWT with secure refresh tokens, Argon2. |
| CT-03 | Database: MongoDB Atlas. |
| CT-04 | File storage: AWS S3 or Cloudflare R2 (provider choice open, INT-08); metadata in MongoDB; no binaries in MongoDB. |
| CT-05 | Background jobs: Redis + BullMQ, only where asynchronous processing is genuinely required. |
| CT-06 | PDF: PDFKit or Playwright — one approach per requirement, no duplication (choice: D-010). |
| CT-07 | Testing: Vitest, Supertest, Playwright. Monitoring: Sentry plus application and integration logs. |
| CT-08 | Version control: Git and GitHub. |
| CT-09 | Separate frontend and backend; modular monolith. |
| CT-10 | Integrations candidates: Mapbox or Google Maps; Stripe; Resend; Twilio; Dropbox Sign or DocuSign; QuickBooks Online; external measurement provider — all subject to validation. |

### 2.2 Proposed Technical Decisions (working defaults, need approval)

| ID | Decision | Rationale | Status |
|---|---|---|---|
| D-001 | Modular monolith with one API process and one worker process from the same codebase | Simplicity; isolates heavy PDF/Chromium work from request handling | Proposed |
| D-002 | npm workspaces (`frontend`, `backend`) at repo root; no Turborepo/Nx | One install and shared scripts without extra tooling | Proposed |
| D-003 | Express 5 | Native async error propagation removes try/catch wrappers | Proposed |
| D-004 | Response envelope `{data, meta}` / `{error:{code,message,details,requestId}}` | Consistent API contract | Proposed |
| D-005 | 15-min JWT access token in memory + rotating opaque refresh token (hashed in DB, httpOnly cookie, reuse detection) | Secure refresh handling as required by CT-02 | Proposed |
| D-006 | Argon2id with library-recommended parameters | Approved hashing algorithm | Confirmed (CT-02) |
| D-007 | Central role→permission map in code + record-scope filters in services | Extensible without a permission-management UI | Proposed |
| D-008 | Customer portal uses separate `portalAccounts` and a separate token audience | Strong isolation between staff and customers | Proposed |
| D-009 | No `tenantId`; company-specific values stored in configuration collections | Avoids SaaS overbuild while keeping future commercialization possible | Proposed |
| D-010 | Playwright (HTML templates → PDF) for all generated documents; PDFKit not used | Image-rich branded layouts; one rendering approach | Proposed |
| D-011 | Money in integer cents, percentages in basis points, decimal.js inside the calculation engine | Exact financial arithmetic | Proposed |
| D-012 | Introduce Redis/BullMQ in Phase 3 with the first real async job | No infrastructure before it is needed | Proposed |
| D-013 | Browser uploads directly to private bucket via presigned URL; backend verifies object; single `fileAssets` collection for all file kinds | Avoids proxying large files; one file model | Proposed |
| D-014 | Configurable lists in `lookupValues`; stages in `pipelineStages` (lead and project pipelines) | Configurable without code changes (LEAD-006, PROJ-003) | Proposed |
| D-015 | Measurement module ships a manual import adapter first; API providers added only after validation | No validated provider API exists yet (INT-01) | Proposed |
| D-016 | Until an e-signature provider is validated, estimates can only be approved via `recorded_manual`: an Admin manually records the approval from a customer-signed paper or PDF document and attaches it. The name refers to manual recording only and is unrelated to offline application functionality (excluded). Portal click-to-accept is enabled only if the client's attorney approves it | Legal enforceability is outside development's authority | Proposed |
| D-017 | Project record is created at scoping time (pre-sale stages); approval moves it to production | Reconciles BR-3–5 (inspections/measurements/estimates belong to projects) with "create projects from approved estimates" | Proposed (Q-025) |
| D-018 | sharp in the worker for thumbnails | Gallery performance with phone-sized photos | Proposed (HEIC part pending R-08 spike) |
| D-019 | pino / pino-http for structured logs | Required application and integration logs | Proposed |
| D-020 | libphonenumber-js for E.164 normalization | Reliable duplicate detection | Proposed |
| D-021 | Roadmap adjustments A1 (project core → Phase 3), A2 (catalog basics → Phase 4), A3 (email adapter at first need) | Data dependencies between modules | Proposed |
| D-022 | Backend module files as `<entity>.<concern>.ts` in one folder instead of one sub-folder per concern | Avoids single-file folders; same separation | Proposed |
| D-023 | Calendar view: established library vs custom grid | APPT-005 needs day/week/month views not provided by shadcn/ui | **Open** — decide at Phase 3 start |
| D-024 | Company time zone default `America/Chicago`; store UTC | Listed service areas are in Central Time | Proposed (Q-029) |
| D-025 | Sequential numbers via `counters` collection, assigned at issue time; formats `EST-YYYY-NNNN`, `INV-YYYY-NNNNN` | Gapless-in-practice, transaction-safe numbering | Proposed (Q-011) |
| D-026 | Estimate totals calculated only in the backend; frontend displays results | One implementation of financial logic | Proposed |
| D-027 | No shared frontend/backend package initially; revisit if schema drift appears | Keeps the approved two-project structure | Proposed |
| D-028 | Host frontend and API on subdomains of the same registrable domain | Enables SameSite=Lax refresh cookie | Proposed |
| D-029 | Hosting vendors for API, worker, Redis and frontend | Must be chosen before Phase 1 staging deploy | **Open** (Q-027) |
| D-030 | Strictly phase-based development; the first implementation task is Phase 1 Foundation only; never all 17 modules at once | Controlled scope and reviewable increments | Confirmed (2026-11-04, project owner instruction) |
| D-031 | Dependencies and infrastructure (Redis, BullMQ, Playwright worker, Sentry, integration SDKs) are introduced only when their phase begins (TECH_STACK §14) | Avoids unused infrastructure in Phase 1 | Confirmed (2026-11-04, project owner instruction) |
| D-032 | CSV import of existing Excel customer and lead data (PRD §6.20) as an initial migration feature; parsing approach decided at approval | Avoids starting with an empty system | Proposed — **pending client approval** (Q-021, CR-01) |
| D-033 | Phase 1 Foundation code landed using working defaults D-002–D-005, D-007, D-019, D-022, D-027; JWT via `jose`; AUTH-008 token endpoints exist but email send is disabled until INT-03 (AUTH-007 temp-password path) | Matches PROJECT §7 / TECH_STACK §14 | Confirmed (implementation 2026-11-04) |
| D-034 | Frontend unit tests use Vitest + Testing Library (`@testing-library/react`, jsdom) for Phase 1 auth guards / permissions | Needed for AUTH-011 / forced-password FE regression without Playwright (Phase 2) | Confirmed (hardening 2026-11-05) |
| D-035 | Phase 1 hardening V-01–V-06: atomic refresh claim, backend mustChangePassword gate, strict forgot/reset/invite rate limit, acceptInvite session revoke, pino-http header redact, local git init (CI green only after remote Actions) | Independent verification findings | Confirmed (2026-11-05) |
| D-036 | Phase 2 Core CRM implemented using working defaults Q-002/003/005/006/028/030; MIG excluded (Q-021); website intake API shipped pending live form (Q-006); Playwright E2E gated on E2E_* env | Phase 2 plan approval | Confirmed (implementation 2026-11-05) |

## 3. Deferred Features

| ID | Feature | Reason |
|---|---|---|
| FE-01 | Manual roof tracing and calculation tool (draw facets on imagery, compute areas/lengths) | Requested as possible future enhancement; not a Roofr replacement in this scope |
| FE-02 | Supplier/distributor API ordering integrations | No validated supplier API (MAT-009, Q-023) |
| FE-03 | Automated appointment reminders (SMS/email) | Not currently required (CB-10) |
| FE-04 | Subcontractor login/portal | Not requested (Q-015) |
| FE-05 | Inbound email capture into CRM | Requires mail routing; not essential initially |
| FE-06 | Marketing campaigns and bulk messaging | Not requested; compliance burden |
| FE-07 | Inventory/stock management | Not requested |
| FE-08 | Native Android and iOS apps; offline mode and sync | Excluded (CB-14) |
| FE-09 | Multi-tenant SaaS, tenant onboarding, subscription billing | Excluded (CB-14) |
| FE-10 | Insurance claims, Xactimate, ESX, supplements, RCV/ACV/depreciation, mortgage checks | Excluded (CB-14) |
| FE-11 | Drone measurement, AI roof recognition, storm/hail intelligence | Excluded (CB-14) |
| FE-12 | Telephony integration / call recording | Phone leads are manual entry (LEAD-004) |

## 4. Unresolved Business Questions

| ID | Question | Needed by | Working default until answered |
|---|---|---|---|
| Q-001 | Final confirmation: six internal users (five salespeople + one administrator) is the confirmed provisional baseline — please confirm. Does an owner/manager also need Admin access? | Phase 1 | 6 users; owner (if any) uses Admin role |
| Q-002 | How should leads be auto-assigned (round-robin, by territory/city, by source, by availability)? Which salespeople receive website leads? | Phase 2 | Round-robin among active salespeople with "receives leads" |
| Q-003 | Can salespeople see other salespeople's leads, customers and projects? | Phase 2 | Own records only; Admin sees all |
| Q-004 | When does a lead become a customer in the business process (first appointment, inspection, signed estimate)? | Phase 2 | Converted before an inspection is recorded (BR-19) |
| Q-005 | What are the actual pipeline stages used today? | Phase 2 | Seed list in LEAD-007 |
| Q-006 | Which platform runs the website and its form? Can it send a webhook/HTTP POST with custom headers? Which fields does it capture? | Phase 2 | Intake endpoint with shared-secret header |
| Q-007 | Which measurement provider should the CRM integrate with — keep Roofr (manual import) or move to an API provider? What volume and budget per report? | Phase 4 | Manual import adapter |
| Q-008 | Payment terms after the 50% advance (on completion? milestones?). Is the advance due at signing or before material delivery? Different terms for commercial work? | Phase 7 | 50% on estimate approval, 50% on completion |
| Q-009 | Sales tax treatment for residential vs commercial and repair vs new construction work in Texas — to be confirmed by the client's accountant. | Phase 4 | Tax rates configurable; default 0% |
| Q-010 | Pricing convention: margin (price = cost ÷ (1 − m)) or markup (price = cost × (1 + m))? Default value? Can salespeople change prices/margins/discounts, and within what limits? | Phase 4 | Margin convention; salespeople may override on own estimates, audited |
| Q-011 | Should auto-generated invoices be sent immediately or reviewed first? Required invoice number format and starting number? | Phase 7 | Draft for review; `INV-YYYY-NNNNN` from 1 |
| Q-012 | Accepted payment methods (check, cash, bank transfer, Zelle, card, ACH, financing)? Pass card fees to customers? | Phase 7 | Manual methods + Stripe card/ACH if enabled; no surcharging |
| Q-013 | Which QuickBooks product (Online or Desktop) and plan? Which records sync and in which direction? Who is the accountant? | Phase 7 | One-way push of customers, invoices, payments to QuickBooks Online |
| Q-014 | Which e-signature provider and plan? Is in-app click-to-accept acceptable (attorney review)? | Phase 5 | `recorded_manual` only (D-016) |
| Q-015 | Do subcontractors need logins? What must a work order contain? Track insurance certificates/W-9s? | Phase 6 | No login; work order PDF; no compliance documents |
| Q-016 | Project categories, project stages and completion checklist items per category. | Phase 3 (core) / 6 | Seed lists in PROJ-001/003 |
| Q-017 | Warranty types, standard durations and documents (manufacturer vs workmanship). | Phase 8 | Configurable types; manual dates |
| Q-018 | Review platforms (e.g., Google) and when review requests should be sent. | Phase 8 | Manual send after completion |
| Q-019 | SMS use cases, business phone number, consent collection method, readiness to complete A2P 10DLC registration. | Phase 8 | Email only until SMS approved |
| Q-020 | Email sending domain and DNS access for verification. | First email use (A3) | Temp-password onboarding (AUTH-007) |
| Q-021 | Approve the proposed CSV import of existing Excel customer and lead data (PRD §6.20)? Which sheets/columns and approximately how many rows? (Jobs, invoices and payments are outside the proposed import.) | End of Phase 1 (to plan Phase 2) | Not implemented until approved |
| Q-022 | Branding and legal content: logo files, colors, license numbers, proposal terms, invoice terms, warranty text. | Phase 3 | Placeholders configurable in settings (not hardcoded) |
| Q-023 | Which material suppliers are used, and how are orders placed today (phone, email, portal)? | Phase 5 | Printable/emailed order PDF |
| Q-024 | Definition of "revenue" for dashboard: collected, invoiced or contracted? | Phase 2 (tile shown from Phase 7) | Collected as primary; others secondary |
| Q-025 | Confirm project-early model (D-017). | Phase 3 | D-017 |
| Q-026 | Data retention and deletion requirements (customer records, photos, messages). | Before go-live | Retain indefinitely; soft deletes |
| Q-027 | Hosting budget, account ownership (client-owned accounts), staging needs, incremental production releases? | Phase 1 | Client-owned accounts; staging + production |
| Q-028 | For commercial clients: is a company with multiple contacts required? | Phase 2 | `type = business` with embedded contacts |
| Q-029 | Company time zone (any work in El Paso/Mountain Time?). | Phase 3 | `America/Chicago` |
| Q-030 | How should salesperson performance be measured? | Phase 2 | Metrics in PRD §6.2 |

## 5. Integration Dependencies

Research notes below are from public sources reviewed on 2026-11-04. They are **not** validation. Every integration remains *Pending validation* until tested with an authorized account.

| ID | Integration | Status | What is needed | Fallback if unavailable |
|---|---|---|---|---|
| INT-01 | Roof measurement provider | Pending validation | Provider decision (Q-007), account, API credentials/partner approval, terms, per-report pricing, sandbox | Manual import adapter (MEAS-005) |
| INT-02 | Stripe (card/ACH) | Pending validation | Client Stripe account, business verification, ACH eligibility, fee review, webhook endpoint | Manual payment recording (PAY-008) |
| INT-03 | Resend (email) | Pending validation | Verified sending domain (DNS), API key | Temp-password onboarding; no customer emails |
| INT-04 | Twilio (SMS) | Pending validation | Account, phone number, A2P 10DLC brand + campaign approval, consent wording | Email only |
| INT-05 | Dropbox Sign or DocuSign | Pending selection & validation | Provider choice, API plan, template approach, legal review of signing flow | `recorded_manual` approval (D-016) |
| INT-06 | QuickBooks Online | Pending validation | Confirm product is QuickBooks Online (Q-013), Intuit developer app, OAuth authorization by client, sandbox + production test, accountant mapping | No sync; Admin exports/enters manually |
| INT-07 | Mapbox or Google Maps | Pending selection | Choose one; API key with domain restrictions; budget | Manual address entry (CUST-009) |
| INT-08 | AWS S3 or Cloudflare R2 | Pending selection | Bucket per environment, credentials, CORS configuration for presigned PUT; verify presigned-URL behavior of the chosen provider | None — required for Phase 3 |
| INT-09 | Website form intake | Pending | Website platform and form method (Q-006) | Manual entry of website leads (temporary) |
| INT-10 | Sentry | Pending setup (introduced no earlier than Phase 2, D-031) | Account/project DSNs | Logs only |
| INT-11 | Material supplier APIs | Deferred | Supplier identification and API validation (Q-023) | Order PDF/email |

### 5.1 Measurement provider research summary (not validation)

| Provider | Public findings | Implication |
|---|---|---|
| Roofr | No public developer API documentation was found. Third-party sources conflict: one software directory states Roofr has no API, while a competitor's comparison claims API access on higher tiers. Roofr reports can also be ordered through a supplier partnership (ABC Supply). Sources: getapp.com/roofing-software/a/roofr, sunbasedata.com/comparisons/sunbase-vs-roofr, roofr.com/partnerships/abc-supply/measurements | Treat as **no confirmed API**. Ask Roofr directly. Manual import supports continued Roofr use. |
| EagleView | Publishes REST web-services documentation covering OAuth2 token authentication, ordering, order status and file retrieval, with a test/sandbox environment via its developer portal. Integrated by several roofing/field-service platforms (e.g., ServiceTitan, Zuper, ProLine). Source: restdoc.eagleview.com | Strong candidate; requires account, developer access approval and commercial terms. |
| HOVER | Publishes developer documentation describing retrieval of measurement PDFs and structured JSON measurements. HOVER builds 3D models from smartphone photos. A partner's documentation states integrations require a HOVER membership and are not available on pay-as-you-go. Sources: developers.hover.to/reference/measurements-and-deliverables, support.sumoquote.com/hover | Candidate; workflow differs (photo capture by salesperson); plan requirements to confirm. |
| GAF QuickMeasure | Available inside partner platforms (AccuLynx, ServiceTitan, Zuper, Leap, Beacon PRO+). No public developer documentation was found. Sources: acculynx.com/integrations/gaf-quickmeasure, zuper.co/integrations/gaf | Likely partner-program access only; inquire with GAF. |

## 6. Technical Assumptions

| ID | Assumption |
|---|---|
| A-01 | Data volume: < 10,000 leads per year, < 200,000 photos total, ≈ 6 concurrent internal users plus portal users. |
| A-02 | All users have reliable internet in the field (offline excluded). |
| A-03 | All amounts are USD; all properties are in the United States (mostly Texas). |
| A-04 | Salespeople use modern iOS Safari or Android Chrome. |
| A-05 | MongoDB Atlas cluster tier supports transactions (replica set). |
| A-06 | The client will own all third-party accounts and grant developer access. |
| A-07 | One company brand; no per-salesperson branding on documents. |
| A-08 | English-only UI and documents. |
| A-09 | No regulatory requirement beyond standard US practices has been identified for stored data; to be confirmed (Q-026). |

## 7. Risks Requiring Validation

Project-level risks are listed in PROJECT.md §10. Items below need a concrete validation action:

| Risk | Validation action | When |
|---|---|---|
| R-01 / R-02 Measurement API access | Contact Roofr, EagleView, HOVER, GAF; obtain written API availability, approval process, pricing; run a sandbox order with the chosen provider | Track V, before Phase 4 |
| R-03 QuickBooks product | Confirm product and plan; connect an Intuit sandbox; test customer/invoice/payment create | Before Phase 7 |
| R-04 Sales tax | Written guidance from client's accountant | Before Phase 4 calculation finalization |
| R-05 SMS registration | Start A2P 10DLC registration | Early — lead time is outside project control |
| R-06 Stripe eligibility | Client completes Stripe onboarding; test card and ACH in test mode | Before Phase 7 |
| R-08 HEIC photos | Spike: upload from current iPhones via mobile Safari; check delivered format; test thumbnail and PDF rendering | Start of Phase 3 |
| R-11 Website form | Identify platform; send a test submission to staging intake endpoint | Phase 2 |
| R-12 E-signature legality | Attorney confirms acceptable signing method | Before Phase 5 |
| Presigned upload limits on chosen storage | Verify content-type/size enforcement and CORS for S3 or R2 | Start of Phase 3 |

## 8. Change Requests

Record any request that adds scope, changes a business rule or touches excluded features here before implementation.

| ID | Date | Request | Decision | Affected docs |
|---|---|---|---|---|
| CR-01 | 2026-11-04 | CSV import of existing Excel customer and lead data (MIG-001–MIG-011) | Proposed — pending client approval (Q-021, D-032) | PRD §6.20, PROJECT §6–7, ARCHITECTURE §18, TECH_STACK §14 |
