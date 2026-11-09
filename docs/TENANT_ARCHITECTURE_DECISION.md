# Tenant (company) architecture decision

Status: **decided for new resources; migration of existing collections is blocked on a business decision** (see §6).
Date: 2026-11-06.

## 1. Why this is needed
The client's forms document says forms must be editable per company because other roofing/remodeling companies may use the platform later. The application was built as a single-company deployment (`PROJECT.md`). A form template, a price catalog or a branding record that belongs to "the" company must therefore be explicitly owned, so that a second company can never read or change it.

## 2. Current single-company assumptions (audit of the code)
| Area | Today | Tenant implication |
|---|---|---|
| `CompanySettings` | One document (`ensureCompanySettings()` returns the first/only one). Holds name, address, tax rate, terms, lead-assignment state, lookups-independent defaults | Must become per-company. Today's singleton is treated as the settings of the **default company**. |
| Users | No company field. Roles `admin` / `salesperson` are global | Needs a `companyId`. Admins are company admins, not platform admins. |
| Customers, properties, leads | Ownership by `ownerId` / `assignedTo` (a user), no company | Isolation currently depends on "all users belong to one company". |
| Estimates, proposals, projects, invoices, payments, inspections, measurements, appointments, work orders, subcontractors, materials, communications, after-sales | Scoped by customer ownership or user, never by company | Same. |
| Files | `File` has no company; storage keys are not company-prefixed | Needs `companyId` and a company prefix in the storage key before shared object storage is used. |
| Lookups, pipeline stages | Global collections with unique `(type,key)` / `(pipeline,name)` | Must become unique per company. |
| Counters (estimate/proposal/invoice numbers) | Global per year | Must become per company. |
| Audit logs | No company | Needs `companyId` for per-company export and access. |
| Portal accounts | `customerId` unique | Portal isolation already works through the customer; it inherits the customer's company. |
| Branding | Static logo in `frontend/public/brand` and `backend/src/assets` | Needs a per-company branding record. |
| Indexes | Single-company uniques (e.g. `Estimate.number` unique globally) | Must become `(companyId, number)`. |

## 3. Options considered
1. **Database per company.** Strong isolation, but cross-cutting migrations, connection management and the existing single connection make it heavy for a modular monolith with one customer today. Rejected for now.
2. **Shared collections with a mandatory `companyId` on every document and every query (chosen).** Fits the current stack (one Mongoose connection) and Atlas.
3. **Add `companyId` to a few models only.** Rejected: it gives the appearance of tenancy without enforcement.

## 4. Decision
- Introduce a `Company` collection. The first company is the **default company**, created from the existing `CompanySettings` the first time it is needed (`ensureDefaultCompany()`).
- Users get an optional `companyId`. A user without one belongs to the default company (lazy backfill on first company-scoped request). This keeps every existing account working.
- A `companyContext` middleware resolves the caller's company once per request and exposes it as `req.companyId`. **Services never accept a company id from the client.**
- Every **new** company-configurable resource has a required `companyId`, indexes that start with `companyId`, and services that filter on it for every read and write:
  - form templates, template versions, form submissions;
  - customer price catalogs (Good/Better/Best);
  - subcontractor rate cards;
  - estimate cost sheets and project cost entries;
  - company branding (on `Company`).
- Linked existing records are authorised through the existing ownership rules **and** a company match: a submission can only link to a customer/property/inspection that belongs to the same company (checked via the company of the owning user until existing collections carry `companyId`).
- Cross-company access returns **404** (not 403), so record existence is not disclosed.
- Photos/signatures use the existing `File` model; new fields `formSubmissionId`, `formFieldId`, `companyId` are added and the storage key is prefixed with the company id for new uploads.

## 5. What is implemented now
`Company`, `User.companyId`, `companyContext` middleware, company-scoped form templates/versions/submissions, price catalogs, subcontractor rate cards, cost sheets, and tests proving a second company's users cannot list, read, update or submit against the first company's resources.

## 6. Not migrated — requires a business decision
The collections in §2 other than the new ones still lack `companyId`. A safe migration is:
1. Add `companyId` (nullable) to each collection with a backfill script that stamps the default company on every existing document (idempotent, dry-run first).
2. Make it required and change unique indexes to `(companyId, …)`.
3. Add the company predicate to every service query; add a contract test that iterates all routers with a second-company token.
4. Move lookups, pipeline stages and counters to per-company.

This touches every module and every index; it needs a maintenance window and a database backup, and the client has not decided whether a second company will actually share this database. **Until step 1–4 are done, the platform must not host a second company's customers.** Form templates, price catalogs, rate cards and branding are already isolated.

## 7. Risks
- Forgetting the company predicate on a future query. Mitigation: services for new models take a `CompanyScope` argument (not optional) and tests assert isolation per route.
- Public intake endpoints (website lead form) must carry an explicit company (per-company intake secret). Today the single secret maps to the default company.
- Storage keys of already uploaded files are not company-prefixed.
