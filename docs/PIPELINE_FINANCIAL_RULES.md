# Pipeline financial rules

These rules are implemented once, in `backend/src/modules/pipeline/pipeline.calc.ts`. The dashboard shows what the backend calculates; no frontend component adds up money.

All money is integer cents (the same as invoices, payments and estimates). There is no floating-point money arithmetic.

## One job, one stage

A **pipeline job** (`pipelineJobs`) is one estimate lineage, plus the project and invoices that grew out of it. A job has exactly one stored `state` (`active`, `denied`, `cancelled`, `archived`) and, when active, exactly one `stage`. Revised versions of an estimate (`parentEstimateId`) belong to the same job (a unique index on the lineage root prevents a second job). A project with no estimate gets its own job.

## Stages and their dollar value

| # | Stage | Job is here when | Amount counted |
|---|---|---|---|
| 1 | Estimates Out | the estimate was sent and is not accepted, denied or void | the sent estimate total |
| 2 | Estimates Accepted | the estimate was accepted (or a project exists for it) and work has not started | contract value |
| 3 | Jobs Started | the project is `in_progress` or `quality_review` (or `on_hold` after it started) | contract value |
| 4 | Jobs Completed | the project is `completed` or `closed` and no invoice has been issued | contract value |
| 5 | Invoiced | work is complete and at least one invoice was issued, but not everything is paid | **outstanding balance** |
| 6 | Invoices Completed | everything billable is paid | amount paid (not in the active pipeline) |

**Contract value** = accepted estimate total (or the project budget for a job that never had an estimate) + approved change orders. Change orders are signed (a credit lowers the contract) and the result never goes below zero. A project linked to an estimate counts as accepted contract value even if nobody pressed "accepted" on the estimate.

**Invoiced amount** = sum of invoices that were issued (`sent`, `partially_paid`, `paid`, `overdue`). Draft and void invoices never count.

**Paid amount** = recorded payments (`status: recorded`) on issued invoices. The payment ledger is the source of truth.

**Outstanding balance** = `max(contract value, invoiced amount) − paid`, never negative. Using the larger of the two means a part-billed contract keeps its unbilled remainder in the pipeline instead of dropping out, and an invoice larger than the contract (extras) is still collected.

**Paid in full** = at least one issued invoice, **no draft invoice waiting**, and `paid ≥ max(contract, invoiced)`. One paid invoice does not complete a job while another is unpaid, while a draft is still to be issued, or while part of the contract has not been billed.

**Overdue** = unpaid money on an issued invoice whose due date has passed.

## Total active pipeline

```
Estimates Out
+ Estimates Accepted
+ Jobs Started
+ Jobs Completed
+ Invoiced (outstanding balance)
```

Excluded: Invoices Completed, denied estimates, cancelled and archived jobs. Each job is in one stage, so it contributes once.

A deposit invoice on a job that is still Accepted or Started does not move the job (invoices move a job to Invoiced only after the work is completed). The deposit payment still reduces the outstanding balance later.

## Denied estimates

`denied` is an estimate status (the older `rejected` is treated the same). Denying records the date, reason, optional customer note and who did it, in the estimate and its append-only `statusHistory`. The estimate is never deleted. Denied jobs show separately (count and value) and are not in any active total. Reopening puts the estimate back to Estimates Out; a revised estimate (`duplicate` as version) that is sent re-uses the same job. A job whose project already exists cannot be denied; cancel the project instead.

## Movement

Normal movement is automatic. The estimate (sent, accepted, denied, reopened), proposal (accepted, rejected), project (created, status changes) and invoice (sent, voided, payment recorded) modules call the pipeline after their own change succeeds. Each call recomputes the stage from the records and moves the job with an atomic compare-and-set on `(stage, version)`. Two simultaneous changes cannot move a job twice, and a lost race re-reads and decides again. Every move is appended to the job's `history` (from, to, when, who, automatic or manual, trigger, reason, value at the time) and to the audit log. If a pipeline update fails it is logged and does not undo the original action; the next change or the import repairs it.

Automatic backward moves happen only when the records change (for example a voided invoice), and never for a job an administrator pinned.

**Manual moves** (`POST /pipeline/jobs/:id/move`, permission `pipeline:manage`, administrators):
- one step forward is a normal move;
- one step back needs a reason;
- a jump, a move into Invoiced with no issued invoice, or a move into Invoices Completed without a fully paid ledger is an **exception**: administrator only, reason required, flagged `exception` in the history;
- every manual move pins the stage so automation will not move it backwards.

## History and "as of" views

`GET /pipeline/summary?asOf=YYYY-MM-DD` finds each job's stage from its stage history at the end of that day (never from the current stage). Invoices and payments are evaluated by their dates, and change orders by their approval date. Limits, which the page shows:
- an invoice or payment that was voided later is shown as it is now, because the void date was not recorded;
- estimate amounts are shown as they are now;
- jobs that existed before the pipeline was introduced were imported by `POST /pipeline/backfill`. Their history is rebuilt from record dates (sent, accepted, project start and end, invoice and payment dates) and every rebuilt entry is marked **approximate**.

## Checks

`pipeline.calc.test.ts` covers the rules above (partial payments, several invoices, deposits, drafts, change orders, overdue, as-of ledger, integer exactness, transition rules). `pipeline.routes.test.ts` runs the whole lifecycle through the real API and database, including concurrency, scope, filters, denial and backfill. `frontend/e2e/pipeline.spec.ts` repeats it in a browser.
