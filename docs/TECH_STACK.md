# Legacy Roofing CRM — Technology Stack

| Field | Value |
|---|---|
| Document | `docs/TECH_STACK.md` |
| Version | 0.1 — Draft |
| Date | 2026-11-04 |
| Related | [ARCHITECTURE.md](./ARCHITECTURE.md) · [DECISIONS.md](./DECISIONS.md) · [CURSOR_RULES.md](./CURSOR_RULES.md) |

This document lists **what** technologies are used and **why**. **How** they fit together is in ARCHITECTURE.md. Items marked **Approved** come from the approved project brief. Items marked **Proposed** are recommended supporting libraries or choices that need approval (tracked in DECISIONS.md). No other major framework may be introduced without a DECISIONS.md entry (CURSOR_RULES.md §12). Listing a technology here does not mean it is installed at project start: each dependency is introduced only when its phase begins (§14).

---

## 1. Runtime and Tooling

| Technology | Status | Purpose |
|---|---|---|
| Node.js (current Active LTS at setup time; pin in `.nvmrc` and `engines`) | Approved | Backend and tooling runtime |
| npm with workspaces (`frontend`, `backend`) | Proposed (D-002) | One install, shared root scripts; no extra monorepo tool |
| TypeScript (strict mode) | Approved | Type safety across frontend and backend |
| ESLint + Prettier | Proposed | Consistent code quality and formatting |
| Git + GitHub | Approved | Version control, pull requests |
| GitHub Actions | Proposed | CI: lint, typecheck, tests, build |

## 2. Frontend

| Technology | Status | Purpose |
|---|---|---|
| React | Approved | UI library |
| Vite | Approved | Dev server and build |
| TypeScript | Approved | Types |
| Tailwind CSS | Approved | Styling |
| shadcn/ui | Approved | Accessible UI components (copied into `components/ui`) |
| React Router | Approved | Routing, protected routes, separate internal and portal route trees |
| TanStack Query | Approved | Server state: fetching, caching, invalidation |
| Zustand | Approved | Small shared client state only (auth session, UI preferences) |
| React Hook Form | Approved | Forms |
| Zod | Approved | Form validation schemas |
| Lucide React | Approved | Icons |
| Calendar view component | Proposed — decision needed (D-023) | APPT-005 day/week/month views; evaluate an established calendar library vs a simple custom grid before adding a dependency |
| Maps SDK (Mapbox GL JS or Google Maps JS API) | Pending selection (INT-07) | Address autocomplete and map display; only one provider |

**Frontend architecture summary:** a single Vite SPA containing two route trees — the internal app (`/app/*`) and the customer portal (`/portal/*`) — each with its own layout and auth context. Code is organized by business domain under `src/modules/`. Details: ARCHITECTURE.md §3.

## 3. Backend

| Technology | Status | Purpose |
|---|---|---|
| Node.js + Express (v5) | Approved (v5 proposed, D-003) | HTTP server; v5 forwards rejected async handlers to error middleware |
| TypeScript | Approved | Types |
| REST API, versioned under `/api/v1` | Approved | API style |
| Mongoose | Approved | MongoDB schemas, models, queries |
| Zod | Approved | Request validation and environment validation |
| JWT (`jsonwebtoken` or `jose`) | Approved | Access tokens |
| Argon2 (`argon2`, Argon2id) | Approved | Password hashing |
| Helmet | Proposed | Security headers |
| cors | Proposed | CORS allow-list |
| cookie-parser | Proposed | Reading the refresh-token cookie |
| express-rate-limit (Redis store once Redis exists) | Proposed | Rate limiting (SEC-006) |
| pino (+ pino-http) | Proposed (D-019) | Structured JSON logging with request IDs |
| libphonenumber-js | Proposed (D-020) | Phone normalization to E.164 for duplicate detection |
| decimal.js | Proposed (D-011) | Exact decimal arithmetic inside the estimate/payment calculation engine only |
| date-fns + @date-fns/tz | Proposed | Date handling in company time zone |

**Backend architecture summary:** modular monolith with two entry points sharing one codebase — `server.ts` (HTTP API) and `worker.ts` (BullMQ workers). Each business module owns its model, service, controller, routes and validation. Third-party adapters live under `src/integrations/`. Details: ARCHITECTURE.md §4.

## 4. Database

| Technology | Status | Purpose |
|---|---|---|
| MongoDB Atlas | Approved | Primary database (replica set, which multi-document transactions require) |
| Mongoose schemas and indexes | Approved | Data modeling and query performance |

**Approach:** referenced collections for entities with independent lifecycles (customers, properties, projects, estimates, invoices, payments, files); embedded sub-documents only for small, bounded data owned by one parent (estimate options and line items, contacts, checklist items, schedule items). Money in integer cents; percentages in basis points. Collection design: ARCHITECTURE.md §5.

## 5. File Storage

| Technology | Status | Purpose |
|---|---|---|
| AWS S3 **or** Cloudflare R2 | Approved, provider pending (INT-08) | Object storage for photos, PDFs, documents |
| `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | Proposed | One client for both (R2 is S3-compatible); presigned upload/download URLs |
| sharp | Proposed (D-018) | Thumbnail generation in the worker; HEIC handling to be confirmed by spike R-08 |

**Approach:** private bucket; browser uploads directly via presigned URL; backend verifies the object before marking it usable; downloads via short-lived signed URLs. Metadata and object keys stored in MongoDB (`fileAssets`). Binaries never stored in MongoDB.

## 6. Authentication

| Item | Choice |
|---|---|
| Password hashing | Argon2id |
| Access token | JWT, 15-minute lifetime, held in memory by the SPA, sent as `Authorization: Bearer` |
| Refresh token | Opaque random token, rotated on every use, stored hashed in `refreshSessions`, sent as httpOnly + Secure + SameSite=Lax cookie on the refresh path only; reuse detection revokes the token family |
| Audiences | `internal` and `portal` tokens are distinct and not interchangeable |
| Authorization | Central role → permission map in code plus record-scope filters in services |

Flow diagrams: ARCHITECTURE.md §7–8.

## 7. Background Jobs

| Technology | Status | Purpose |
|---|---|---|
| Redis (managed) | Approved | BullMQ backend; rate-limit store |
| BullMQ | Approved | Queues and workers |

**Used only for work that is genuinely asynchronous:** PDF generation, thumbnail generation, measurement provider polling/result retrieval, outbound email/SMS sending, QuickBooks sync, processing of verified webhook events that trigger heavier work, scheduled jobs (estimate expiry). Simple CRUD never goes through a queue. Redis is introduced in Phase 3 with the first real job (D-012).

## 8. PDF Generation

| Technology | Status | Purpose |
|---|---|---|
| Playwright (Chromium) in the worker | Proposed (D-010) — chosen from the approved options | All generated documents: inspection reports, proposals, invoices, receipts, work orders, material orders |

**Why one approach:** all documents are branded, image-rich layouts that are easier to build and maintain as HTML/CSS templates. Using PDFKit for some documents and Playwright for others would duplicate layout logic. PDFKit is therefore not used. Implication: the worker deployment needs Chromium (ARCHITECTURE.md §15).

## 9. Integrations

All integrations sit behind adapters in `backend/src/integrations/` (ARCHITECTURE.md §12). None is enabled in production until validated.

| Integration | Status | Library approach |
|---|---|---|
| Roof measurement provider | Pending validation; manual import adapter first | Provider's documented API via `fetch`; no SDK assumption |
| Stripe (card/ACH) | Pending validation | Official `stripe` Node SDK; Stripe-hosted payment UI |
| Resend (email) | Pending validation | Official `resend` SDK |
| Twilio (SMS) | Pending validation | Official `twilio` SDK; webhook signature validation |
| Dropbox Sign or DocuSign | Pending selection | Official SDK of the selected provider only |
| QuickBooks Online | Pending validation | OAuth 2.0 + REST via `fetch` (or Intuit's official OAuth library if useful) |
| Mapbox or Google Maps | Pending selection | Frontend SDK for autocomplete; backend geocoding via REST |
| Sentry | Pending account setup | `@sentry/react`, `@sentry/node` |

## 10. Testing Strategy

| Tool | Scope |
|---|---|
| Vitest | Unit tests (backend services, calculation engine, utilities; frontend hooks and complex components) |
| Supertest | API integration tests against the Express app |
| mongodb-memory-server (replica-set mode) | Proposed: isolated MongoDB for integration tests, including transactions |
| @testing-library/react + jsdom | Phase 1 frontend unit tests for route guards and permission hooks (D-034) |
| Playwright Test | End-to-end tests of critical workflows in a real browser, including a mobile viewport |

**Mandatory coverage areas** (CURSOR_RULES.md §11): authentication and authorization (including portal isolation), lead creation/assignment/conversion/duplicates, estimate calculations, payment schedules and balances, measurement data validation and versioning, file upload permissions and validation, webhook signature and idempotency. External providers are tested at the adapter boundary with recorded fixtures taken from real sandbox responses — never invented payloads presented as real.

## 11. Monitoring and Logging

| Tool | Purpose |
|---|---|
| Sentry | Errors and performance traces for frontend, API and worker; PII scrubbing on |
| pino structured logs | Request logs (request ID, user ID, route, status, duration); integration logs (provider, operation, duration, result, correlation ID) |
| `integrationEvents` / `syncRecords` collections | Business-visible status of webhooks and syncs (Admin UI) |

## 12. Deployment Recommendations (Proposed, Q-027)

| Component | Recommendation |
|---|---|
| Frontend | Static hosting with CDN (e.g., Cloudflare Pages, Netlify or Vercel) on `app.<client-domain>` |
| API | Container or managed Node host (e.g., Render, Railway, Fly.io, AWS) on `api.<client-domain>` — same registrable domain as the frontend so SameSite=Lax cookies work |
| Worker | Separate process/service from the same image, with Chromium installed for Playwright |
| Database | MongoDB Atlas dedicated or flex tier with automated backups (tier per budget) |
| Redis | Managed Redis with persistence suitable for BullMQ |
| Storage | S3 or R2 private bucket; separate buckets or prefixes per environment |
| Environments | `local`, `staging`, `production`, each with its own database, bucket, Redis and provider sandbox/live keys |
| Ownership | All accounts registered in the client's name with developer access (Q-027) |

Specific hosting vendors are not decided; record the choice in DECISIONS.md before Phase 1 staging deployment.

## 13. Explicitly Not Used

To prevent stack creep: no Next.js or other SSR framework; no GraphQL; no Redux; no additional ORM/ODM besides Mongoose; no microservices, message brokers or serverless functions beyond the API + worker; no CSS-in-JS libraries; no second component library; no PDFKit (D-010); no Docker requirement in production unless chosen by hosting (Docker Compose may be used locally for MongoDB/Redis).

## 14. Dependency Introduction Schedule (D-031)

Install a dependency only when the phase that needs it begins. Phase 1 installs only what Phase 1 requirements need.

| Dependency | Introduced |
|---|---|
| Frontend core (React, Vite, TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query, Zustand, React Hook Form, Zod, Lucide) | Phase 1 |
| Backend core (Express, Mongoose, Zod, JWT library, argon2, helmet, cors, cookie-parser, express-rate-limit with in-memory store, pino) | Phase 1 |
| Vitest, Supertest, mongodb-memory-server, ESLint, Prettier, @testing-library/react + jsdom | Phase 1 |
| libphonenumber-js, date-fns + @date-fns/tz | Phase 2 (first module that needs them) |
| Playwright Test (E2E testing only) | Phase 2 (first E2E workflow, W-1) |
| Sentry SDKs | When INT-10 is set up, no earlier than Phase 2 |
| Redis, BullMQ, `worker.ts`, Redis store for rate limiting | Phase 3 (first real async job) |
| Playwright/Chromium for PDF generation in the worker | Phase 3 (RPT) |
| AWS SDK S3 client + presigner, sharp | Phase 3 (INSP) |
| Calendar component (if chosen, D-023) | Phase 3 (APPT) |
| Maps SDK | When INT-07 is selected and enabled |
| decimal.js | Phase 4 (calculation engine) |
| Measurement provider, e-signature, Stripe, QuickBooks, Resend, Twilio SDKs/clients | In their phase, and only after the integration is validated (DECISIONS.md §5) |
| CSV parsing approach (if MIG is approved) | Decided at approval (D-032) |
