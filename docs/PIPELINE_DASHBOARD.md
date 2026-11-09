# Pipeline dashboard

Page: **Pipeline** (`/app/pipeline`, permission `pipeline:read`). Rules: `PIPELINE_FINANCIAL_RULES.md`.

## What it shows
- Title "Legacy Construction Group — Pipeline Dashboard" and the line "Every job sits in exactly one stage. When a job moves forward, its dollar amount moves with it."
- A dark banner with the **total active pipeline**, the active job count and the written calculation.
- Six clickable stage cards in order (Estimates Out, Estimates Accepted, Jobs Started, Jobs Completed, Invoiced, Invoices Completed), each with its colour, count, dollar amount and a one-line meaning. Below 62 rem the row scrolls sideways.
- A bar showing each of stages 1 to 5 as a share of the active total (paid-in-full jobs are not in it).
- A **Denied estimates** strip (count and value, excluded from every total) with a drill-down.
- A drill-down table for the selected stage with customer, property, job type, the stage date, amounts, salesperson and project manager, search, sorting, pagination and a stage total that equals the card. Invoiced adds invoiced, paid, balance due, due date and an overdue marker; Invoices Completed adds invoiced and paid. Customer names open the project (or estimate) page. **History** expands the job's stage history; administrators can move a job (reason required for exceptions) and add change orders there.
- Filters: stage-entered date range, salesperson, project manager, job type, payment status, and **View as of** a past date.

Salespeople see only the customers they own. Administrators see everything and can import existing jobs (one time).

## Estimate decisions
Estimate pages have **Mark accepted**, **Mark denied** (reason required, optional customer note), **Reopen estimate** and **Create revised estimate**. Accepting or rejecting a proposal does the same to its estimate.

## API
`GET /pipeline/summary`, `GET /pipeline/jobs`, `GET /pipeline/filter-options`, `GET /pipeline/jobs/:id` (history and change orders), `POST /pipeline/jobs/:id/move`, `POST /pipeline/jobs/:id/change-orders`, `POST /pipeline/backfill`; `POST /estimates/:id/accept|deny|reopen`. See `API.md`.

## First use
Jobs that existed before this feature are not in the pipeline until an administrator presses **Import existing jobs** on the dashboard (or `POST /pipeline/backfill`). It is safe to run repeatedly. New activity is picked up automatically.
