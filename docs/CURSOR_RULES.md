# Legacy Roofing CRM — Cursor Development Rules

| Field | Value |
|---|---|
| Document | `docs/CURSOR_RULES.md` |
| Version | 0.1 |
| Date | 2026-11-04 |
| Audience | Cursor AI and every human developer on this repository |

These rules are mandatory. "MUST" and "MUST NOT" are absolute. If a rule conflicts with a task instruction, stop and ask instead of choosing silently.

---

## 1. Mandatory Reading Before Every Task

Before writing or changing any code, you MUST:

1. Read this file completely.
2. Read the PRD sections for the requirement IDs in the task ([PRD.md](./PRD.md)).
3. Read the relevant sections of [ARCHITECTURE.md](./ARCHITECTURE.md) (module structure, collection design, the workflow involved).
4. Check [DECISIONS.md](./DECISIONS.md) for confirmed decisions, open questions (`Q-NNN`) and integration status (`INT-NN`) affecting the task.
5. Check [TECH_STACK.md](./TECH_STACK.md) before using or adding any library.
6. Inspect the existing code in the affected modules and search the codebase for similar functionality (§2.2).

### 1.1 Phase-based development (mandatory)

- Development is strictly phase-based (PROJECT.md §7). Every task belongs to exactly one phase and lists its requirement IDs.
- You MUST NOT implement all 17 modules at once, implement more than one phase in a task, or scaffold models, routes, pages or folders for later phases.
- The **first implementation task is Phase 1 Foundation only**: repository setup, frontend/backend initialization, environment configuration, database connection, authentication, user management, roles/permissions, settings skeleton and audit log. Nothing from Phase 2 or later.
- A new phase starts only when the previous phase meets its exit criteria and a human confirms the start.
- Features marked pending approval (e.g., CSV import, MIG) are not implemented until DECISIONS.md marks them approved.

If a task has no requirement ID, contradicts the documents, touches excluded scope (PRD §12), or depends on an unanswered question, you MUST stop and report this before implementing.

## 2. Coding Philosophy

### 2.1 Simplest maintainable solution
- Write code only for a documented requirement.
- Prefer plain functions and modules over classes, frameworks and patterns. Introduce an abstraction only when there are at least two real, current uses.
- No speculative features, options, flags, hooks or extension points "for later".
- No wrapper functions that only rename or forward another function.
- No configuration files, folders or placeholder files for modules that are not being implemented now.

### 2.2 Reuse before writing
Before creating a component, hook, service, utility, schema, type or constant:
1. Search the codebase (names, behavior, similar logic).
2. If something similar exists, reuse it or extend it.
3. If you create something new that overlaps with existing code, refactor to one implementation in the same change.

Known single implementations that MUST be reused: `services/http.ts` (frontend HTTP), `utils/phone`, `utils/address-key`, `utils/money`, numbering service, audit service, storage adapter, estimate calculator, permission map, error classes, pagination helper.

### 2.3 Honest software
Nothing pretends to work. If a dependency (credentials, provider access, client answer) is missing, implement only the documented boundary, disable the feature in the UI with an explanation, and report what remains incomplete (§18, §19).

## 3. Task Workflow

1. **Understand:** restate the requirement IDs and acceptance criteria you are implementing.
2. **Plan:** list files to create/change. Keep the change limited to the task.
3. **Implement:** backend first (model → service → validation → controller → routes → tests), then frontend (api hooks → components → page).
4. **Test:** write and run the tests required by §11. Run lint, typecheck and the full test suite.
5. **Document:** update documentation per §15.
6. **Report:** summarize what was built, test results, any deviations, and any incomplete parts or new open questions.

Do not mix unrelated refactors, formatting sweeps or dependency upgrades into a feature change.

## 4. Project Structure Rules

- Follow the structure in ARCHITECTURE.md §3 (frontend) and §4 (backend). Do not invent new top-level folders.
- Backend module = folder under `backend/src/modules/<module>/` with files `<entity>.<concern>.ts` (`model`, `service`, `controller`, `routes`, `validation`, `types`, tests). Promote a concern to a sub-folder only when it has more than one file (D-022).
- Frontend domain = folder under `frontend/src/modules/<domain>/` with `api.ts`, `components/`, `schemas.ts`, `types.ts` as needed. Pages in `src/pages/` stay thin.
- Third-party adapters live only in `backend/src/integrations/<capability>/<provider>/`.
- BullMQ processors live only in `backend/src/jobs/workers/`.
- Create a module's folder only when its implementation starts. No empty folders and no `index.ts` barrel files that only re-export.
- Shared cross-domain UI goes into `components/shared/` only after it is used in two domains.

## 5. Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Files (backend & frontend non-components) | kebab-case | `lead.service.ts`, `address-key.ts` |
| React component files | PascalCase | `LeadForm.tsx` |
| React components | PascalCase | `LeadForm` |
| Hooks | `use` + camelCase | `useLeads`, `useConvertLead` |
| Variables, functions | camelCase, verb-first for functions | `assignLead`, `calculateOption` |
| Types, interfaces | PascalCase, no `I` prefix | `Lead`, `CreateLeadInput` |
| Zod schemas | camelCase + `Schema` | `createLeadSchema` |
| Constants | UPPER_SNAKE_CASE (true constants only) | `MAX_PHOTO_BYTES` |
| Mongoose models | PascalCase singular | `LeadModel` |
| Collections | plural camelCase | `leads`, `fileAssets` |
| Money fields | `…Cents` (integer) | `totalCents` |
| Percent fields | `…Bp` (basis points) | `marginBp` |
| Dates | `…At` for timestamps, `…Date` for calendar dates | `issuedAt`, `startDate` |
| Booleans | `is…`, `has…`, `can…` | `isActive` |
| API paths | plural kebab-case nouns | `/api/v1/material-orders` |
| Permissions | `resource:action` | `invoices:issue` |
| Audit actions | `entity.verb_past` | `invoice.issued` |
| Error codes | UPPER_SNAKE_CASE | `LEAD_ALREADY_CONVERTED` |
| Branches | `type/REQ-ID-short-description` | `feat/LEAD-013-duplicate-detection` |
| Env vars | UPPER_SNAKE_CASE | `MONGODB_URI` |

## 6. TypeScript Rules

- `strict: true` in both projects; also `noUncheckedIndexedAccess` and `noImplicitOverride`.
- MUST NOT use `any`. Use `unknown` and narrow it. ESLint `no-explicit-any` is an error.
- MUST NOT use `as` assertions to silence errors. Allowed only with a one-line comment explaining why the type system cannot know it (e.g., after a runtime check). No non-null `!` assertions except in tests.
- All external input (HTTP bodies, params, queries, webhooks, provider responses, environment variables, file metadata) is validated at runtime with Zod. Infer types from schemas (`z.infer`) instead of duplicating them.
- Keep types next to their module (`<entity>.types.ts` or `types.ts`). Global `types/` only for truly global shapes.
- Explicit return types on exported functions and service methods.
- Use discriminated unions for states; exhaustive `switch` with a `never` check.
- No `enum` keyword; use `as const` objects or string literal unions.

## 7. Frontend Rules

- Server state MUST use TanStack Query. Never store server data in Zustand or component state copies.
- Zustand only for: auth session (access token in memory, current principal) and small UI preferences.
- All HTTP goes through `services/http.ts`. Components never call `fetch` directly.
- Forms with validation use React Hook Form + Zod (`zodResolver`). Field errors from the API (`details[]`) are mapped onto form fields.
- Every data view implements **loading, empty, error and success** states using the shared components.
- Business logic (totals, balances, permissions decisions, status transitions) belongs to the backend. The frontend may only compute display-only values (e.g., formatting) and MUST NOT compute authoritative money values.
- Permission checks in the UI use the permission list from `/auth/me` via one helper; they hide controls but are never the security control.
- Use shadcn/ui components and Tailwind utilities. No other component library, no CSS-in-JS, no inline style objects except for dynamic values (e.g., annotation coordinates).
- Mobile first for field features (PRD NFR-001); test at 360 px.
- Accessibility: every input has a label; interactive elements are keyboard-reachable; icons-only buttons have `aria-label`.
- Dates displayed in the company time zone via the shared formatter; money via the shared money formatter.
- No hardcoded business data (stages, sources, prices, tax rates) in the UI — load them from the API.

## 8. Backend Rules

- Layering is fixed: routes → middleware → controller → service → model (ARCHITECTURE §4).
- Controllers are thin: read `req.validated` and `req.auth`, call one service method, return the envelope. No database calls, no business rules.
- Services own business logic, scope filters, transactions, audit entries and job enqueueing.
- Modules call other modules' services, never their models (except read-only analytics aggregation).
- Every private route has `authenticate` and `authorize('<permission>')`. Record scope is applied in the service query itself (`find`, `update`, `delete`) — never fetch first and check later in the controller.
- Out-of-scope records return 404 (SEC-005).
- Status changes go through explicit service methods that validate allowed transitions (state machines in ARCHITECTURE §13).
- Use MongoDB transactions (`session.withTransaction`) when one operation writes multiple documents that must stay consistent: lead conversion, estimate approval, invoice issuing, payment create/refund, numbering.
- Environment variables are read only through `config/env.ts`.
- Never return Mongoose documents directly; map to response DTOs that exclude secrets and internal fields (`passwordHash`, `tokenHash`, cost/margin for portal).
- Long-running or external work (PDFs, thumbnails, provider polling, messaging, accounting sync) goes to BullMQ. Simple CRUD MUST NOT be queued.

## 9. Database Rules

- Define a Mongoose schema with types, `required`, enums and `timestamps: true` for every collection listed in ARCHITECTURE §5. Do not add collections not listed there without updating ARCHITECTURE.md in the same change.
- Add the documented indexes. Add an index for any new frequent query filter or sort, and document it.
- Use references for entities with independent lifecycles; embed only bounded child data (ARCHITECTURE §5).
- Money as integer cents; percentages as basis points. Never store floats for money.
- Unique constraints enforce invariants (emails, numbers, provider IDs). Handle duplicate-key errors (`11000`) as `409` with a clear code.
- Use `lean()` for read-only queries that return DTOs.
- Referential consistency is enforced in services (e.g., verify `projectId` belongs to `customerId` before linking).
- Never delete records that have dependents; archive or deactivate per PRD.
- Migrations/seed scripts are explicit, idempotent scripts under `backend/scripts/` and documented in README.md. Seed data contains configuration defaults only (stages, lookups) — never fake business records in production.

## 10. API Rules

- REST under `/api/v1`. Plural nouns; state transitions as explicit `POST /:id/<action>` endpoints.
- Response envelope and status codes exactly as ARCHITECTURE §9.
- Every endpoint validates `params`, `query` and `body` with Zod via the `validate` middleware; unknown keys are stripped.
- List endpoints are paginated (`page`, `pageSize` ≤ 100) and sorted deterministically.
- No endpoint without a consumer in the current task. No generic "update anything" endpoints.
- Webhook and public intake endpoints follow ARCHITECTURE §14 and SEC-010/011.
- Changes to endpoints update the endpoint table in ARCHITECTURE §9 in the same PR.

## 11. Testing Requirements

Tests are required for behavior, not for coverage numbers. MUST NOT write tests that only assert that mocks were called or that a component renders without meaningful assertions.

| Area | Required tests |
|---|---|
| Auth | Login success/failure, rate limit, refresh rotation, reuse detection, deactivated user, audience separation (portal vs internal) |
| Authorization | For every new endpoint: unauthenticated → 401; missing permission → 403; out-of-scope record → 404 |
| Leads | Create, website intake idempotency, duplicate detection (format variants), assignment rule, conversion transaction and idempotency |
| Estimates | Calculator unit tests (quantities, waste, rounding, margin, overrides, discounts, tax, edge cases); revision immutability |
| Payments | Schedule split rounding, partial payments, overpayment rejection, balance recalculation, refund, webhook signature and replay |
| Measurements | Manual import validation, versioning, estimate snapshot isolation, provider adapter normalization with recorded sandbox fixtures |
| Files | Type/size/content rejection, context authorization, signed URL access control |
| Portal | Cross-customer isolation for every portal endpoint |
| CSV import (only if approved) | Mapping and row validation, duplicates vs database and within file, preview writes nothing, idempotent confirm, Admin-only access |
| E2E (Playwright) | W-1 to W-7 as their phases complete, including a mobile viewport for field flows |

- Backend integration tests use Supertest against `app.ts` with mongodb-memory-server (replica set).
- External providers are never called in automated tests; adapters are tested with fixtures captured from real sandbox responses and labeled with their source and date.
- A bug fix includes a test that fails before the fix.

## 12. Dependency Rules

Before adding any package:
1. Check TECH_STACK.md — is it already approved, or is there an approved package that does this?
2. Check whether the platform or an existing dependency already covers it (e.g., `Intl` for formatting, `crypto` for random tokens).
3. Prefer established, maintained packages with TypeScript types.
4. Never add two packages for the same job.
5. Install a package only when the phase that needs it begins (TECH_STACK.md §14). Phase 1 MUST NOT install Redis, BullMQ, Playwright PDF/worker infrastructure, Sentry SDKs or third-party integration SDKs unless an approved Phase 1 requirement needs them.
6. Any package not listed in TECH_STACK.md requires a DECISIONS.md entry and a TECH_STACK.md update in the same PR, with justification.

MUST NOT add: alternative state managers, UI kits, ORMs, HTTP clients (use `fetch`), date libraries besides date-fns, utility megalibraries (e.g., lodash) for one function, or any package to implement an excluded feature. Pin versions via the lockfile; commit `package-lock.json`.

## 13. Security Rules

- Implement SEC-001 to SEC-016 from the PRD; they are not optional.
- Passwords: Argon2id via the auth service only. Tokens: generated with `crypto.randomBytes`, stored hashed (SHA-256).
- Never log passwords, tokens, cookies, authorization headers, full request bodies of auth/payment/webhook routes, or message contents.
- No secrets in code, tests, fixtures, docs examples or commits. `.env` files are git-ignored; `.env.example` lists variable names with empty or placeholder values.
- Validate and sanitize all input; never build Mongo queries from raw objects (`req.body` spread into a filter is forbidden).
- File uploads only via the documented upload-intent flow (ARCHITECTURE §10).
- Rate-limit auth, intake and webhook routes.
- CORS allow-list from env; no wildcard origins with credentials.
- Raw card/bank data MUST NOT pass through the backend.

## 14. Error Handling and Logging

- Throw typed errors (`AppError` subclasses with `code`, `status`, safe `message`, optional `details`) from services; the central error handler formats responses.
- MUST NOT write empty `catch` blocks or swallow errors. A `catch` must handle, translate (rethrow as `AppError` with `cause`), or log and rethrow.
- Client responses never include stack traces, raw provider errors, query details or internal IDs of other entities.
- Unexpected errors are logged with request ID and, once Sentry is introduced (TECH_STACK.md §14), reported to Sentry.
- Integration calls log provider, operation, duration, outcome and correlation ID; failures update the business record's status (e.g., measurement `failed`, sync record `failed`) so Admin can see them.
- Frontend: query/mutation errors show the API's safe message; unexpected errors show a generic message and are reported to Sentry once it is introduced.

## 15. Documentation Updates

In the same PR as the code change:
- **PRD.md:** if behavior differs from a requirement, or a [P] item is confirmed (change label to [C] and note the decision ID).
- **ARCHITECTURE.md:** new/changed collections, indexes, endpoints, workflows, queues.
- **DECISIONS.md:** any new decision, assumption, open question, dependency or integration status change. Never mark an integration "Validated" without evidence (§18).
- **TECH_STACK.md:** any new dependency.
- **README.md:** new scripts, environment variables, setup steps.
Keep information in one document and link to it; do not copy the same content into several files.

## 16. Definition of Done for Each Task

A task is done only when ALL are true:

- [ ] Implements exactly the referenced requirement IDs and their acceptance criteria — no more.
- [ ] Backend authorization and scope enforced and tested (401/403/404 cases).
- [ ] Input validated with Zod on the backend (and in forms where relevant).
- [ ] Loading, empty, error and success states present in UI; works at 360 px for field features.
- [ ] Required tests from §11 written and passing; `lint`, `typecheck`, `test` pass locally and in CI.
- [ ] No `any`, no unexplained assertions, no empty catches, no `console.log` left in code (use the logger).
- [ ] No hardcoded business values, mock data, fake responses or placeholder numbers in production code.
- [ ] Audit entries written where AUD-002 applies.
- [ ] No unused code, files, exports or dependencies introduced.
- [ ] Documentation updated per §15.
- [ ] Final report lists: what changed, tests run, deviations, incomplete parts, new questions.

## 17. Git and Change Management

- Branch from `main` using `type/REQ-ID-description` (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`).
- Conventional Commits with requirement IDs: `feat(leads): add duplicate detection [LEAD-013]`.
- One logical change per PR; PR description lists requirement IDs, summary, test evidence, screenshots for UI, and documentation updated.
- `main` is protected: PRs require green CI; no direct pushes; no force-push to shared branches.
- Never commit `.env`, credentials, generated PDFs, uploaded files or `node_modules`.
- Scope changes (new features, excluded items, changed business rules) are first recorded in DECISIONS.md as change requests and approved before implementation.

## 18. Integration Rules

- Implement an integration only when DECISIONS.md lists it as approved for implementation and access has been validated (or as a boundary-only task).
- Use only documented provider endpoints from the provider's official documentation; link the documentation page in the adapter file header. MUST NOT guess endpoints, fields, auth methods, limits or prices.
- Core modules depend on the capability interface (e.g., `MeasurementProvider`, `SignatureProvider`), never on vendor SDK types.
- Each adapter handles: authentication, request validation, response validation (Zod), timeouts, retries for transient errors only, logging, status tracking and webhook signature verification.
- Credentials come from env or encrypted `integrationConnections`; never from the client.
- An integration is "Validated" only after a successful real call against an authorized sandbox/live account, recorded in DECISIONS.md with date and scope tested.
- Do not create adapters for unapproved providers "to be ready" (no speculative `providers/roofr` etc.).

## 19. Prohibited Practices

MUST NOT:
1. Implement any excluded feature (PRD §12) or anything not tied to a requirement ID.
2. Fake an API response, payment success, measurement result, message send or signature status.
3. Hardcode dashboard/report numbers, prices, tax rates, margins, stages, lead sources or payment percentages.
4. Add multi-tenant fields (`tenantId`, `companyId`) or SaaS billing.
5. Store binaries (images, PDFs) in MongoDB.
6. Store raw card or bank account data.
7. Compute authoritative totals or balances on the frontend.
8. Bypass the service layer from controllers or other modules.
9. Use `any`, empty catch blocks, or disable lint/type rules to make code pass (except a justified single-line disable with comment).
10. Create empty folders, placeholder files, unused exports, or "utils" that duplicate existing ones.
11. Add dependencies not approved in TECH_STACK.md/DECISIONS.md.
12. Commit secrets or `.env` files.
13. Write tests that assert nothing meaningful, or delete/skip failing tests to get green CI.
14. Silently change a documented business rule; report the conflict instead.
15. Mark tasks or integrations complete when parts are missing.
16. Implement several phases at once, build ahead of the current phase, or implement features pending approval (e.g., CSV import).
17. Present manual measurement data import as a provider integration, or build/advertise a provider API integration before its access is validated.
