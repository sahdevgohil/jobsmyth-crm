# Client requirements traceability

Source: the client brief and three client documents were **provided in the task text, not as files in the repository**. Status: DONE = built and tested; PARTIAL; BLOCKED; NOT BUILT.

| # | Requirement | Status | Where | Evidence |
|---|---|---|---|---|
| 1 | Multi-company: company-scoped forms, submissions, catalogs, branding | PARTIAL | `modules/companies`, `companyId` on new collections | Forms and pricing isolation tests. Branding is stored on `Company` but the app UI and PDF still use the Legacy branding. Existing collections are not migrated (BLOCKED, see `TENANT_ARCHITECTURE_DECISION.md`) |
| 2 | Dynamic form builder (versions, 15 types, conditionals, validation, activation, backend validation) | DONE | `shared/form-engine.ts`, `modules/forms`, `/app/forms` | engine 9, forms API 9, browser check that the builder opens |
| 3 | Submission history | PARTIAL | API list, PDF report | No dedicated history screen |
| 4 | Customer intake with per-channel consent (timestamp, source, wording, version) | DONE | `intake.service.ts`, `/app/intake` | intake 5 tests, browser journey |
| 5 | Roofing job details with conditional insurance section | DONE | `roofing_job_details` | engine and forms tests |
| 6 | Roofing inspection with required photo checklist | DONE | `roofing_inspection` | completion test; browser journey shows the checklist blocking completion |
| 7 | Remodeling inspection (area based) | DONE | `remodeling_inspection` | browser journey |
| 8 | Gutters, siding, windows/doors, paint, fencing, decks/patios, solar/skylights | DONE | 7 templates | install test; gutter inspection in browser journey |
| 9 | Offline PWA (manifest, service worker, shell, IndexedDB, photo queue, local signature, sync queue, retry, conflicts, duplicate protection, sync UI, optional GPS) | PARTIAL | `modules/offline`, `public/sw.js` | 6 unit tests, sync API tests, browser offline journey. Real phones, cold-start offline from the service worker and offline intake are untested or not built |
| 10 | Branded PDF report, acknowledgement-only signature | DONE | `report.service.ts` | report 2 tests |
| 11 | Good/Better/Best catalog seeded DRAFT / unapproved | DONE | `default-catalogs.ts` | pricing tests |
| 12 | Separate internal subcontractor rate cards and cost management | DONE | `pricing.service.ts`, `/app/rate-cards` | pricing tests |
| 13 | Estimate/profitability: gross margin, not markup | DONE | `grossMarginBps`, cost panel | tests and browser journey |
| 14 | Price snapshots | DONE | `pricingSource` | snapshot test |
| 15 | Data reuse | PARTIAL | intake to customer/property/lead; quote to estimate | Inspection to measurement import not built |
| 16 | UI: intake, builder, field inspection, photo capture, sync UI, quote/estimate, subcontractor cost, PDF | DONE | see `IMPLEMENTATION_STATUS.md` | |
| 17 | UI: measurements and project workspace changes for the new data | NOT BUILT | | existing screens unchanged |
| 18 | Permissions and audit for forms, pricing, costs, margins, branding | PARTIAL | `permissions.ts`, audit calls | `branding:manage` exists; no branding screen |
| 19 | Demo seed extension (idempotent, draft pricing, fictional data) | PARTIAL | `scripts/lib/demo-field.ts` | 3 draft inspections; no sample photos, completed reports or demo estimates from the catalog |
| 20 | Tests including a browser journey | PARTIAL | `e2e/client-requirements.spec.ts` | The full lead-to-partial-payment journey is the existing `business-journey.spec.ts`; the new spec covers intake, inspections, offline, quote and cost |

## Decisions still needed from the client
Warranty terms and manufacturer eligibility; price approval; tax treatment (CPA); legal review of the consent wording; supplier validation of line items; which existing records belong to which company (multi-company migration).
