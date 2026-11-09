# Phase 2 — Independent Verification Review

| Field | Value |
|---|---|
| Project | Legacy Roofing CRM |
| Scope | Phase 2 Core CRM only (no Phase 3) |
| Review date | 2026-11-05 |
| Method | Read-only code review vs PRD, PROJECT, ARCHITECTURE, TECH_STACK, CURSOR_RULES, DECISIONS, PHASE1_VERIFICATION_REPORT, PHASE2_REPORT; plus executed local tests |
| Code modified | **No** |

---

## Verdict

Phase 2 is a **usable Core CRM slice** for local demos: lead CRUD/scope, stage rules (on the stage API), sequential convert/intake idempotency, customer/property basics, and live dashboard aggregations work and are partially automated.

It is **not Phase-3-ready** until high-severity correctness/security gaps below are fixed (assignment concurrency, intake race, create-time stage bypass, stage-deactivation orphans, overclaimed DASH-005 / LEAD-006 / CUST-007 FE), customer/pipeline regression tests are added, and frontend Vitest is stopped from loading Playwright E2E files.

**Exit criteria:** W-1 met locally (SPA+API). W-2 API met sequentially; live website still blocked on **Q-006 / INT-09** (consistent with DECISIONS + PHASE2_REPORT). Staging still blocked on **Q-027**.

---

## Tests actually executed (this review)

| Suite | Command | Result |
|---|---|---|
| Backend Vitest | `npm test -w backend` | **37 passed** (executed 2026-11-05) |
| Frontend Vitest | `npm test -w frontend` | **6 unit tests passed**, then Vitest also loaded `e2e/*.spec.ts` and **failed** (Playwright `test.describe` in Vitest) |
| Playwright E2E | `npm run test:e2e -w frontend` | **4 skipped** — `E2E_API_URL` and `E2E_EMAIL` unset |

### Test count meaning (cumulative vs Phase 2)

| Claim | Reality |
|---|---|
| “37 backend tests” | **Cumulative** total for the backend workspace, not “37 new Phase 2 tests” |
| Approx Phase 1 carryover | Auth 17 + settings 3 + users 2 + audit 2 + logging 1 ≈ **25** |
| Approx Phase 2 additions | Leads 6 + analytics 1 + phone utils 2 + address-key 3 ≈ **12** |
| “6 frontend tests” | **Still Phase 1 only** (smoke, permissions, RequireAuth). **No Phase 2 FE unit tests** for leads/customers/dashboard |

### Untested by E2E (env missing)

Required to run Playwright specs:

- W-2 API: `E2E_API_URL`, optionally `E2E_INTAKE_SECRET`
- W-1 UI: `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD` (+ running SPA/API)

Until those are set against a live stack, **W-1 browser flow and live intake E2E remain unexecuted**.

---

## 1. Verified requirements (code + tests)

| Area | Verified | Evidence |
|---|---|---|
| LEAD-001 identity rules | Yes (service) | `validateLeadIdentity` / `normalizeLeadContact` in `lead.service.ts` |
| LEAD-005 self-assign vs RR | Yes | Salesperson → self; else `assignRoundRobin` (`receivesLeads`) |
| LEAD-009 lost reason | Yes | `changeStage` → `LOST_REASON_REQUIRED`; test |
| Stage→won blocked on stage API | Yes | `USE_CONVERT` in `changeStage` |
| LEAD-012 convert idempotent (sequential) | Yes | Transaction + early return; test |
| LEAD-013 phone format dupes | Yes | E.164 via `normalizePhoneE164`; test |
| AC-LEAD-5 IDOR 404 | Yes | `findLeadInScope` + test |
| LEAD-003 sequential intake idempotency | Yes | `externalSubmissionId` unique + test |
| SEC-005 customer scope | Yes | `customerScopeFilter` / `findCustomerInScope` |
| DASH-001/002/003/006 | Yes | `analytics.service.ts`; AC-DASH-1/2 test |
| Archived customers excluded from dashboard | Yes | `archivedAt: null` |
| Q-006 / INT-09 documented blocker | Yes | PHASE2_REPORT §1/§6 aligns with DECISIONS INT-09 |
| MIG excluded | Yes | No import module/routes |

---

## 2. Findings

### Critical

*None identified for auth IDOR on leads/customers under sequential use.*

### High

| ID | Finding | Location |
|---|---|---|
| **V2-01** | Round-robin cursor is **not atomic**. Comment says “Atomically advances”; implementation is read → compute → `updateOne` **without** conditioning on prior `lastAssignedUserId`. Concurrent intakes can double-assign / skip salespeople. | `lead-assignment.service.ts` `assignRoundRobin` |
| **V2-02** | Website intake is check-then-insert; no handling of Mongo `11000` on `externalSubmissionId`. Concurrent same `submissionId` → loser **500**; RR cursor may still have advanced inside failed `createLead`. | `lead.service.ts` `ingestWebsiteLead` / `createLead`; `lead.model.ts` unique sparse index |
| **V2-03** | `createLead` accepts any `stageId` (including **won** / **inactive**), bypassing `changeStage` rules (`USE_CONVERT`, `STAGE_INACTIVE`). | `lead.service.ts` ~286–288 |
| **V2-04** | Intake notifications run **after** lead commit with no isolation. Failure → 500; idempotent retry returns `created: false` so **notification may never send** (AC-LEAD-1 weakened). | `ingestWebsiteLead` after `createLead({ notify: false })` |
| **V2-05** | Deactivating a pipeline stage does **not** move or block leads still on that stage. Kanban + `activeLeads` only use **active** open stages → leads become invisible in pipeline/active metrics while remaining in DB/list. | `pipeline-stage.service.ts` `updatePipelineStage`; `LeadPipelinePage.tsx`; `analytics.service.ts` |
| **V2-06** | PHASE2_REPORT overclaims DASH-005: most tiles link to bare `/app/leads` or `/app/customers` (only overdue is filtered). | `HomePage.tsx` tile `to` values |
| **V2-07** | LEAD-006 marked Done, but Admin UI is add + deactivate only — **no rename / reorder** despite API + page copy. | `PipelineStagesPage.tsx`; missing FE reorder hook |
| **V2-08** | CUST-007 marked Done, but `CustomerNewPage` never calls duplicate-check (unlike leads). | `CustomerNewPage.tsx` vs `customer.routes.ts` |
| **V2-09** | Frontend Vitest includes `e2e/**/*.spec.ts` (no exclude) → `npm test -w frontend` **fails** when Playwright specs exist. Delivery “6 passed” is fragile. | `frontend/vitest.config.ts` |

### Medium

| ID | Finding | Location |
|---|---|---|
| **V2-10** | `assignLead` / admin create `assignedTo` do not verify user exists, active, salesperson. | `lead.service.ts` `assignLead` / `createLead` |
| **V2-11** | Public intake shares `authStrictRateLimiter` with forgot/reset/invite — same IP bucket across unrelated surfaces. | `lead.routes.ts`, `auth.routes.ts`, `rate-limit.ts` |
| **V2-12** | Intake secret compared with `!==` after body validation (not constant-time; work before auth). | `lead.controller.ts` `websiteIntake` |
| **V2-13** | Honeypot response `leadId: null` distinguishable from replay `leadId: <id>`. | `ingestWebsiteLead` |
| **V2-14** | Email not Zod-validated; any string satisfies “phone or email”. | `lead.validation.ts`, `normalizeEmail` |
| **V2-15** | DASH-004 date filter exists on API but HomePage never exposes `from`/`to`; period `totalLeads` won’t match unfiltered list. | `analytics.routes.ts`, `HomePage.tsx` |
| **V2-16** | No dedicated customer/pipeline/archive/delete/won-uniqueness/deactivate-with-leads tests; AC-CUST-1 evidence is one property via convert, not two. | Missing `customers*.test.ts` |
| **V2-17** | Reorder only updates IDs in payload; omitted stages keep old orders (gaps/dupes). | `reorderPipelineStages` |
| **V2-18** | Admin stage list includes inactive; Lead detail stage picker does not filter `isActive` → easy `STAGE_INACTIVE`. | `listPipelineStages`, `LeadDetailPage.tsx` |
| **V2-19** | `DELETE /customers/:id` authorized as `customers:archive` (salesperson passes middleware, then service 403). | `customer.routes.ts` |
| **V2-20** | List search builds `RegExp` from raw user input (ReDoS / meta-chars). | `listLeads` / `listCustomers` |
| **V2-21** | Property `propertyTypeKey` validated on create, not on update. | `customer.service.ts` |

### Low

| ID | Finding |
|---|---|
| **V2-22** | Kanban is select-to-move, not drag-and-drop (acceptable if documented; PRD LEAD-015 says DnD). |
| **V2-23** | Embedded customer `contacts[]` ignored by duplicate detection. |
| **V2-24** | No property delete / customer unarchive API. |
| **V2-25** | Salesperson performance rate mixes created-in-range vs converted-in-range cohorts. |
| **V2-26** | Global 1mb JSON body limit only (no intake-specific smaller cap). |

---

## 3. Security summary

| Check | Result |
|---|---|
| API permissions on new routes | Present (`authenticate` + `authorize`); record scope in services for leads/customers |
| Salesperson IDOR on leads | **Pass** (404) |
| Public intake secret | Required when configured; missing secret → 503 |
| Rate limit on intake | Present but **shared** with auth-strict routes (V2-11) |
| Zod validation | Present; business identity rules mostly in service |
| Mongo operator injection | Zod `.strict()` on bodies; ObjectId checks on ids — generally OK |
| Secret in logs | Intake secret not intentionally logged; pino redact of auth headers remains Phase 1 |
| Notification / assignment races | **High** under concurrency (V2-01, V2-02, V2-04) |

---

## 4. Documentation discrepancies (not corrected in this review)

| Claim in PHASE2_REPORT | Verification |
|---|---|
| DASH-005 Done — tiles link to filtered lists | **Overstated** — mostly unfiltered routes (V2-06) |
| LEAD-006 Done — Admin stage management UI | **Partial** — no rename/reorder UI (V2-07) |
| CUST-007 Done — duplicate detection on create | **API yes / FE no** (V2-08) |
| AC-CUST-1 Pass via convert + property path | **Weak** — one property in convert test, not two |
| AC-CUST-2 Done | **Untested** in automated suite |
| SEC-010 Done | **Partial** — sequential OK; concurrent + notify reliability gaps |
| “37 backend / 6 frontend” | **Cumulative** backend; frontend still Phase 1-only units; FE `npm test` currently breaks on E2E pickup |
| Q-006 / INT-09 blocker | **Consistent** with DECISIONS.md |

---

## 5. Missing tests (priority before Phase 3)

1. Concurrent round-robin fairness / cursor CAS  
2. Concurrent same `submissionId` (expect 201 idempotent, never 500)  
3. Intake: bad/missing secret, honeypot, rate 429  
4. Create lead with won/inactive `stageId` rejected  
5. Notify failure after intake (lead exists; no uncaught 500 / or retryable notify)  
6. Customer archive hide, hard-delete with/without relations, salesperson customer 404  
7. Deactivate stage that still has leads (policy assertion once chosen)  
8. Second active won stage → `WON_STAGE_EXISTS`  
9. Salesperson `POST /leads/:id/assign` → 403  
10. Vitest exclude `e2e/**` (or move E2E out of Vitest roots)  
11. FE: RequirePermission on Stages; duplicate panel on customer create (optional unit)

---

## 6. Fixes required before Phase 3

**Must-fix (High):**

1. Atomic round-robin (`findOneAndUpdate` conditioned on previous cursor, or equivalent).  
2. Intake: wrap create in unique-index-safe path (catch 11000 → return existing); prefer transaction with assignment.  
3. Reject won/inactive `stageId` on `createLead`.  
4. Isolate intake notification failures (log + durable retry or best-effort without failing the HTTP success after lead exists).  
5. Define and enforce stage-deactivation policy (block deactivate if leads remain, or auto-move).  
6. Align FE/docs: filtered dashboard links **or** downgrade DASH-005; stage rename/reorder UI **or** downgrade LEAD-006; customer duplicate-check UI **or** downgrade CUST-007.  
7. Exclude Playwright E2E from Vitest so `npm test` is green.

**Should-fix (Medium):** assignee validation; dedicated intake rate limiter; customer/pipeline regression tests; date filter UX or clearer dashboard copy; active-only stage picker.

**External blockers (not code):** Q-006/INT-09 live form; Q-027 staging; optional INT-10 Sentry.

---

## 7. Phase 2 readiness

| Question | Answer |
|---|---|
| Local demo of W-1? | **Yes** |
| Claim Phase 2 “complete / exit criteria met”? | **No** — W-2 live site + staging incomplete; High findings open |
| Safe to start Phase 3? | **No** until High items above are fixed (or explicitly waived) and FE test runner is stable |
| Documentation alone trustworthy? | **No** — several “Done” statuses overstate FE/AC evidence |

---

## 8. Sign-off

| Role | Date | Decision |
|---|---|---|
| Independent reviewer (read-only) | 2026-11-05 | Phase 2 **conditionally usable**; **not** cleared for Phase 3 without High-priority fixes |
| Client / project owner | | Pending |

**Next step:** Approve a hardening plan for V2-01–V2-09 (and selected Mediums), then re-verify. Do not scaffold Phase 3 until that gate passes.
