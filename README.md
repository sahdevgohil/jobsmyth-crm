# Legacy Roofing CRM

A web-based CRM and business management system for **Legacy Construction Group** (Texas, USA), covering leads, customers and properties, appointments, inspections and photo reports, roof measurements, estimates and proposals, materials, projects and subcontractors, invoices and payments, accounting sync, communication, a customer portal, after-sales and analytics.

> **Status:** Phase 1 Foundation + hardening V-01–V-05 implemented (auth, users, settings, audit). Local git initialized; **GitHub Actions is not green until a remote exists and a workflow run succeeds**. Staging deploy blocked on Q-027 / D-029. Password-reset/invite **email delivery** disabled until INT-03 — temp-password onboarding with backend `mustChangePassword` enforcement.

## Documentation

| Document | Purpose |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Product requirements with IDs, business rules, acceptance criteria |
| [docs/PROJECT.md](docs/PROJECT.md) | Scope, phases, milestones, dependencies, risks, definition of done |
| [docs/TECH_STACK.md](docs/TECH_STACK.md) | Technologies and their purpose |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, collections, flows, diagrams |
| [docs/CURSOR_RULES.md](docs/CURSOR_RULES.md) | Mandatory development rules (read before every task) |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions, open questions, assumptions, integration status |
| [docs/PHASE1_REPORT.md](docs/PHASE1_REPORT.md) | Phase 1 Foundation delivery report (coverage, tests, blockers) |
| [docs/PHASE1_VERIFICATION_REPORT.md](docs/PHASE1_VERIFICATION_REPORT.md) | Independent Phase 1 verification & hardening review |

## Technology Stack (summary)

- **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui, React Router, TanStack Query, Zustand, React Hook Form, Zod, Lucide React
- **Backend:** Node.js, Express, TypeScript, REST (`/api/v1`), Mongoose, Zod, JWT + rotating refresh tokens, Argon2id
- **Data & infrastructure:** MongoDB Atlas, Redis + BullMQ, AWS S3 or Cloudflare R2
- **Documents:** Playwright-rendered PDFs
- **Integrations (pending validation):** measurement provider, Stripe, Resend, Twilio, Dropbox Sign/DocuSign, QuickBooks Online, Mapbox/Google Maps
- **Quality:** Vitest, Supertest, Playwright, ESLint, Prettier, Sentry

Full details: [docs/TECH_STACK.md](docs/TECH_STACK.md).

## Prerequisites

- Node.js — current Active LTS (version pinned in `.nvmrc` during Phase 1)
- npm (bundled with Node.js)
- Git
- A MongoDB instance that supports transactions: a MongoDB Atlas development cluster, or a local single-node replica set (Docker Compose may be used locally)
- Redis (required from Phase 3) — local via Docker Compose or a managed instance
- Access to an S3-compatible bucket for development (from Phase 3)

## Repository Structure

```
legacy-roofing-crm/
  frontend/          # React SPA (internal app /app and customer portal /portal)
    src/
  backend/           # Express API (server.ts) and worker (worker.ts)
    src/
    scripts/         # idempotent seed/migration scripts
  docs/              # project documentation (source of truth)
  package.json       # npm workspaces + root scripts
  README.md
```

Internal structure of `frontend/src` and `backend/src`: [docs/ARCHITECTURE.md §3–4](docs/ARCHITECTURE.md). Module folders are created only when their phase starts.

## Installation

```bash
git clone <repository-url> legacy-roofing-crm
cd legacy-roofing-crm
nvm use            # uses .nvmrc
npm install        # installs both workspaces
```

## Environment Setup

Copy the examples and fill in values. Never commit `.env` files.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

**Backend (`backend/.env`)** — variables are validated at startup by `src/config/env.ts`; the process exits if a required variable is missing. Integration variables are required only when that integration is enabled.

| Variable | Purpose | Required from |
|---|---|---|
| `NODE_ENV` | `development` / `test` / `production` | Phase 1 |
| `PORT` | API port | Phase 1 |
| `APP_URL` | Frontend origin (CORS, links in emails) | Phase 1 |
| `CORS_ORIGINS` | Comma-separated allowed origins | Phase 1 |
| `MONGODB_URI` | MongoDB connection string | Phase 1 |
| `JWT_ACCESS_SECRET` | Access-token signing secret (≥ 32 random bytes) | Phase 1 |
| `JWT_PORTAL_SECRET` | Portal access-token signing secret | Phase 8 |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh session lifetime | Phase 1 |
| `ENCRYPTION_KEY` | AES-256-GCM key for stored integration tokens | First OAuth integration |
| `SENTRY_DSN` | Backend/worker error reporting | When INT-10 is set up (no earlier than Phase 2) |
| `LEAD_INTAKE_SECRET` | Shared secret for website lead intake | Phase 2 |
| `REDIS_URL` | Redis for BullMQ / rate limits | Phase 3 |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | S3/R2 object storage | Phase 3 |
| `MAPS_API_KEY` | Server-side geocoding (selected provider) | When INT-07 enabled |
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email | When INT-03 enabled |
| `MEASUREMENT_PROVIDER_*` | Credentials of the validated provider (names defined when implemented) | When INT-01 enabled |
| `SIGNATURE_PROVIDER_*` | Credentials of the selected e-signature provider | When INT-05 enabled |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payments | When INT-02 enabled |
| `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI`, `QUICKBOOKS_ENVIRONMENT` | Accounting | When INT-06 enabled |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` | SMS | When INT-04 enabled |

**Frontend (`frontend/.env`)** — only public values (prefixed `VITE_`); never put secrets here.

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | API base URL, e.g. `http://localhost:4000/api/v1` |
| `VITE_SENTRY_DSN` | Frontend error reporting (when Sentry is introduced, no earlier than Phase 2) |
| `VITE_MAPS_PUBLIC_KEY` | Browser maps/autocomplete key (domain-restricted), when INT-07 enabled |

## Local Development

```bash
npm run dev              # frontend (Vite) and backend API in watch mode
npm run dev:frontend     # frontend only
npm run dev:backend      # API only
npm run dev:worker       # background worker (from Phase 3)
npm run seed             # idempotent configuration seed: admin user prompt, default stages and lookups (no fake business data)
```

## Quality and Testing

```bash
npm run lint             # ESLint, both workspaces
npm run typecheck        # tsc --noEmit, both workspaces
npm test                 # Vitest unit + Supertest integration tests
npm run test:e2e         # Playwright end-to-end tests (from Phase 2; requires running app)
npm run format           # Prettier
```

CI runs `lint`, `typecheck`, `test` and `build` on every pull request; merges to `main` require green CI.

## Build

```bash
npm run build            # builds frontend (static files) and backend (compiled JS)
npm run start            # starts compiled API
npm run start:worker     # starts compiled worker (requires Chromium for PDFs)
```

## Contributing

Read [docs/CURSOR_RULES.md](docs/CURSOR_RULES.md) before any change. Development is strictly phase-based: the first implementation task is Phase 1 Foundation only, and dependencies are installed only when their phase begins ([docs/PROJECT.md §7](docs/PROJECT.md), [docs/TECH_STACK.md §14](docs/TECH_STACK.md)). Branches use `type/REQ-ID-description`, commits use Conventional Commits with requirement IDs, and every PR updates the affected documentation.
