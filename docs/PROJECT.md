# Legacy Roofing CRM — Project Document

| Field | Value |
|---|---|
| Document | `docs/PROJECT.md` |
| Version | 0.1 — Draft |
| Date | 2026-11-04 |
| Related | [PRD.md](./PRD.md) · [DECISIONS.md](./DECISIONS.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) |

This document defines *what is delivered, in which order, and what it depends on*. Requirement details live in PRD.md; open questions, assumptions and integration status live in DECISIONS.md.

---

## 1. Project Introduction

Legacy Roofing CRM replaces Excel-based and manual processes at Legacy Construction Group with a single web application covering leads, customers and properties, appointments, inspections and photo reports, roof measurements, estimates and proposals, materials, projects and subcontractors, invoices and payments, accounting sync, communication, a customer portal, after-sales and reporting.

## 2. Client Background

| Item | Information | Source |
|---|---|---|
| Client | Legacy Construction Group | Client brief |
| Website | https://builtbylegacygroup.com/ | Client brief |
| Location | Texas, USA | Client brief, website |
| Ownership | Family-owned | Website |
| Experience | 20+ years | Website, client brief |
| Service areas listed on website | Houston, Austin, San Antonio, Harlingen, Dallas–Fort Worth metroplex | Website (to be confirmed as current) |
| Services | Residential and commercial construction; roofing and roof replacement; storm damage and restoration; general construction; remodeling and renovations; exterior construction and repairs; gutters and windows; interior repairs and improvements | Client brief, website |

## 3. Business Context

- **Current tools:** Excel and manual processes; Roofr for roof measurements. [C]
- **Lead sources:** door knocking, word of mouth, website inquiries. [C] Phone calls are captured manually. [C]
- **Team:** six internal users — five salespeople and one administrator — confirmed as the provisional initial baseline. The client initially said "five employees"; final client confirmation is still pending (Q-001). [C, pending final confirmation]
- **Sales model:** each salesperson manages a customer from first inquiry through project completion. [C]
- **Delivery model:** work is performed with subcontractors. [C]
- **Organization:** residential and commercial work is handled by the same team. [C]
- **Payments:** customers pay a 50% advance before work starts. [C] Remaining terms are not yet specified (Q-008).
- **Automation requested:** website inquiries enter the CRM automatically; leads are automatically assigned; invoices are generated automatically. [C]
- **Not currently required:** automatic appointment reminders. [C]

## 4. Project Objectives

1. One system of record for all customer, property, project and financial data.
2. Automatic capture and assignment of website leads.
3. A measurement → estimate → material list → invoice chain with no re-typing.
4. Field-friendly photo documentation and branded inspection reports from a phone browser.
5. Accurate, record-derived balances, revenue and pipeline reporting.
6. Customer self-service through a portal.
7. A maintainable modular codebase that does not preclude future commercialization (without building SaaS features now).

## 5. Approved Scope

The 17 modules specified in PRD.md §6: Authentication & Users, Dashboard, Leads & Pipeline, Customers & Properties, Appointments, Roof Measurement Integration, Photos & Inspections, Photo Reports, Estimates & Proposals, Materials, Projects, Invoices & Payments, Accounting Integration, Communication, Customer Portal, After-Sales, Reports & Analytics — plus cross-cutting Settings and Audit Trail.

Integration-dependent features (measurement provider API, Stripe, QuickBooks, Twilio, e-signature, maps, supplier ordering) are in scope **as integration boundaries**; their provider implementations are committed only after validation (§9, DECISIONS.md §5).

## 6. Excluded Scope

Native Android and iOS apps; offline mode and offline sync; multi-tenant SaaS architecture and tenant onboarding; SaaS subscription billing; insurance claims management; Xactimate integration; ESX import/export; supplement management; RCV/ACV/depreciation calculations; mortgage check tracking; drone measurement; automated AI roof recognition; storm and hail intelligence platform.

Also not included unless approved: automated appointment reminders, telephony, inventory management, marketing campaigns, subcontractor logins, manual roof tracing tool (FE-01). CSV import of existing Excel customer and lead data is a **proposed** initial migration feature, pending client approval (PRD §6.20, Q-021, CR-01); it is not committed scope until approved.

Any request touching excluded scope is logged in DECISIONS.md as a change request; it is not implemented silently.

## 7. Development Phases

**Development is strictly phase-based.** Phases are implemented one at a time, in the order below. A phase starts only after the previous phase meets its exit criteria (§11) and the client has reviewed it. Each development task belongs to exactly one phase and references its requirement IDs. Cursor must never implement all 17 modules at once, and must not scaffold models, routes or pages for later phases. **The first implementation task is Phase 1 Foundation only.** Features pending approval (such as CSV import, MIG) are not implemented until DECISIONS.md marks them approved.

The phase order follows the approved roadmap. Three adjustments are **proposed** (D-021) because of data dependencies; they move work earlier, not out of scope:

- **A1.** A minimal *project core record* (create/list/detail/stage, linked to customer and property) moves to Phase 3, because inspections, measurements and estimates attach to projects (BR-3 to BR-5). Full project management stays in Phase 6.
- **A2.** *Catalog basics* (catalog items with estimating rules) move to Phase 4, because the estimate calculation engine needs them. Suppliers, material lists and orders stay in Phase 5.
- **A3.** A transactional *email adapter* (Resend) is introduced at first real need (password reset/invites, report sharing) once the sending domain is verified, rather than waiting for Phase 8.

A parallel **validation track (V)** runs from the start: it confirms open questions and validates integration access so that later phases are not blocked.

### Phase 1 — Foundation
- Repository setup (Git/GitHub, npm workspaces, lint, format, typecheck, CI).
- Frontend and backend initialization; environment configuration; structured logging.
- MongoDB Atlas connection (replica set for transactions).
- Authentication (AUTH-001–014), user management, roles and permission map.
- Company settings and lookup lists (SET-001–003) skeleton; audit log (AUD-001, AUD-004).
- **Exit criteria:** an Admin can sign in, create a salesperson, and the salesperson can sign in with restricted access; CI green; deployed to a staging environment.
- **Not installed in Phase 1** (unless an approved Phase 1 requirement needs it): Redis, BullMQ, Playwright PDF/worker infrastructure (`worker.ts`), Sentry SDKs, third-party integration SDKs. Each is introduced when its phase begins (TECH_STACK §14).

### Phase 2 — Leads and Customers
- Leads, pipeline stages, activities and follow-ups, assignment, duplicate detection, conversion (LEAD-001–016).
- Customers and properties (CUST-001–009).
- Website lead intake (LEAD-003) — requires Q-006 answered.
- Dashboard with lead and customer metrics only (DASH-001–006).
- Sentry introduced once INT-10 is set up.
- *Only if approved (Q-021):* CSV import of customers and leads (MIG-001–011).
- **Exit criteria:** W-1 and W-2 work end-to-end on staging with the real website form (or a documented blocker).

### Phase 3 — Field Work
- Appointments and calendar (APPT-001–008).
- Project core record (adjustment A1).
- Inspections, photo upload to object storage, tagging, annotations (INSP-001–012).
- Background jobs (Redis/BullMQ) and the worker process with Playwright introduced for thumbnails and PDF generation.
- Branded PDF inspection reports (RPT-001–006).
- **Exit criteria:** W-3 works on iOS Safari and Android Chrome; report PDF approved by client for branding.

### Phase 4 — Measurements and Calculation Engine
- Measurement module with provider-independent model and **manual measurement data import** (MEAS-001, MEAS-005–007, MEAS-009–011) — committed.
- **External measurement provider API integration** (MEAS-002–004, MEAS-008) — conditional, built only if a provider's access is validated in track V; not a committed deliverable.
- Catalog basics (adjustment A2: MAT-001, MAT-002, MAT-004).
- Estimate calculation engine with full unit tests (EST-005–012 logic).
- Note: "measurement report generation" in the original roadmap means storing and displaying the provider's report; the CRM does not produce its own measurement reports (no tracing tool in scope).
- **Exit criteria:** AC-MEAS-1–4 pass; calculation engine test suite covers AC-EST-1–2.

### Phase 5 — Estimates, Proposals and Materials
- Estimates with options, revisions, templates, approval, proposal PDF (EST-001–020).
- E-signature provider adapter if validated; otherwise `recorded_manual` approval only — Admin records approval from a customer-signed paper/PDF document (D-016).
- Suppliers, material lists, material orders (MAT-003, MAT-005–010).
- **Exit criteria:** W-4 and the estimate/material part of W-5 work end-to-end.

### Phase 6 — Project Management
- Full project management: stages, subcontractors, scheduling, tasks, work orders, documents, phase photos, checklists, progress (PROJ-001–012).
- **Exit criteria:** a project runs from Sold to Completed with checklist enforcement.

### Phase 7 — Invoices, Payments, Accounting
- Payment schedules, automatic invoice generation, invoices, manual payments, receipts, outstanding/aging (PAY-001–011, PAY-014–015).
- Stripe online payments if validated (PAY-012).
- QuickBooks Online sync if validated (ACCT-001–008).
- **Exit criteria:** W-6 works; AC-PAY-1–4 pass; QuickBooks tested against the client's authorized company or explicitly reported as blocked.

### Phase 8 — Communication, Portal, After-Sales, Analytics
- Email and SMS with templates, consent and history (COMM-001–011) — SMS only after 10DLC approval.
- Customer portal (PORT-001–008).
- Warranties, feedback, review requests, referrals (AS-001–007).
- Reports and analytics (ANL-001–014); dashboard completed with all tiles.
- **Exit criteria:** W-7 works; portal isolation tests (AC-PORT-1) pass.

### Validation Track V (parallel, starts in Phase 1)

| Item | Needed before |
|---|---|
| Answers to Q-001–Q-006, Q-021 | End of Phase 1 |
| Website platform & form method (INT-09) | Phase 2 |
| Storage provider and bucket (INT-08), maps provider (INT-07) | Phase 3 |
| Measurement provider decision, account and API access (INT-01) | Phase 4 |
| Tax treatment (Q-009), margin convention (Q-010) | Phase 4 |
| E-signature provider (INT-05) | Phase 5 |
| Payment terms (Q-008), invoicing rules (Q-011), Stripe eligibility (INT-02) | Phase 7 |
| QuickBooks product and authorized company (INT-06) | Phase 7 |
| Email domain (INT-03); SMS number and 10DLC registration (INT-04) | Phase 8 (email possibly earlier, A3) |

Integration feasibility must be confirmed before an implementation commitment is made for that integration.

## 8. Milestones

| ID | Milestone | Completion evidence |
|---|---|---|
| M0 | Documentation approved; open questions Q-001–Q-006 answered | Client sign-off; DECISIONS.md updated |
| M1 | Foundation on staging | Phase 1 exit criteria |
| M2 | Lead-to-customer pipeline live on staging | Phase 2 exit criteria |
| M3 | Field documentation live | Phase 3 exit criteria |
| M4 | Measurements and calculation engine | Phase 4 exit criteria |
| M5 | Sales cycle complete (estimate → signature → materials) | Phase 5 exit criteria |
| M6 | Production management | Phase 6 exit criteria |
| M7 | Financial cycle complete | Phase 7 exit criteria |
| M8 | Customer-facing and analytics complete; production go-live readiness | Phase 8 exit criteria; restore test done; UAT sign-off |

Calendar dates are not set in this document; they depend on team size and the validation track. Go-live of earlier phases to production (incremental release) is recommended after M2, subject to client agreement (Q-027).

## 9. Dependencies

| Dependency | Owner | Blocks |
|---|---|---|
| Client answers to open questions | Client | Phase-specific (see track V) |
| Hosting accounts in client's name (Atlas, frontend/API hosting, domain/DNS; storage and Redis from Phase 3) | Client + developer | Phase 1 staging |
| Branding assets: logo, colors, license text, proposal and invoice terms | Client | RPT, EST-016, PAY-006 |
| Website platform access | Client / web vendor | LEAD-003 |
| Measurement provider account and API approval | Client + provider | MEAS API adapter |
| Stripe account verification | Client | PAY-012 |
| QuickBooks product confirmation, authorized company, accountant input | Client + accountant | ACCT |
| Resend verified domain (DNS records) | Client DNS admin | Email |
| Twilio number + A2P 10DLC brand/campaign approval | Client | SMS |
| E-signature provider account and API plan | Client | EST-017 |

## 10. Project Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R-01 | Roofr has no verifiable public API | Cannot automate the current provider | Manual import adapter (MEAS-005); evaluate EagleView/HOVER/GAF; ask Roofr directly |
| R-02 | Provider API access requires partner approval or paid tiers | Phase 4 adapter delayed | Validation track starts early; manual adapter keeps workflow usable |
| R-03 | QuickBooks product is Desktop, not Online | ACCT design invalid | Confirm Q-013 before Phase 7 |
| R-04 | Texas sales tax treatment differs by job type | Incorrect invoices | Tax configurable, default 0% until accountant confirms (Q-009) |
| R-05 | SMS registration (A2P 10DLC) takes time or is rejected | SMS unavailable at launch | Start registration early; email works independently |
| R-06 | Stripe ACH/card eligibility or fees unacceptable | No online payments | Manual payment recording is complete without Stripe |
| R-07 | Scope size (17 modules) vs schedule | Delays | Phased delivery with exit criteria; strict scope control via DECISIONS.md |
| R-08 | iPhone photos arriving as HEIC cannot be rendered in PDFs/browsers | Broken reports | Technical spike in Phase 3 before finalizing INSP-003 |
| R-09 | Unclear data visibility rules between salespeople | Rework of queries/UI | Q-003 answered before Phase 2 |
| R-10 | Existing Excel data migration not yet approved | Empty system at go-live | Proposed CSV import (PRD §6.20); client decision on Q-021 before Phase 1 ends |
| R-11 | Website platform cannot post to an API endpoint | No automatic website leads | Identify platform (Q-006); options: webhook, embedded CRM form, or email-to-lead (to be validated) |
| R-12 | E-signature legal requirements for contracts | Unenforceable approvals | Client's attorney confirms signing method; use established provider |

## 11. Definition of Done

**Task level:** defined in [CURSOR_RULES.md §16](./CURSOR_RULES.md#16-definition-of-done-for-each-task).

**Phase level:** a phase is done when:

1. All requirement IDs in the phase meet PRD §13 global acceptance criteria.
2. Phase exit criteria (§7) are demonstrated on staging.
3. CI is green: lint, typecheck, unit, integration and the phase's E2E tests.
4. No open `critical` or `high` defects for the phase's features.
5. Integrations in the phase are either validated against real accounts or explicitly reported as blocked, with the boundary implemented and the fallback documented.
6. DECISIONS.md, PRD.md and README.md reflect what was actually built.
7. The client has reviewed the phase on staging.
