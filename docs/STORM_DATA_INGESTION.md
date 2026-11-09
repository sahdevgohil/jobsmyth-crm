# Storm data ingestion

Code: `backend/src/modules/storm/storm.ingest.ts`, providers in `providers/`, scheduler in `storm.scheduler.ts`. Screen: **Storm data imports** (`/app/storm/imports`, permission `stormEvents:import`, administrators).

## Units of work
Data is imported in units: an **NCEI data year** (`ncei:2024`) or an **SPC report day** (`spc:2024-05-20`). Each unit is recorded in `stormImportUnits` with its status (`pending`, `done`, `failed`, `unavailable`), counts, attempts, last error and (for NCEI) the file version that was imported.

## Properties
- **Idempotent.** Events are upserted on the unique key `(source, sourceRecordId)`. Importing a unit twice inserts nothing the second time (tests assert this for both sources, including a forced re-import).
- **Deduplicated.** The same key can never exist twice. A corrected report updates in place; the same id from the other source is a different report.
- **Resumable.** A backfill skips units that are `done` (and, for NCEI, whose file version has not changed). After a failure, run it again: only unfinished units run. A newer NCEI file version makes that year stale and it is imported again.
- **Streamed.** An NCEI year is gunzipped and parsed as a stream (the CSV parser handles multi-line quoted narratives) and written in batches of 500. A whole year is never held in memory.
- **Honest.** A run is `completed` only when every unit succeeded. Units that failed or that NOAA has not published make it `completed_with_errors`; if nothing succeeded it is `failed`. The page says **"Backfill is NOT complete"** until every year from 2009 to the current year is imported. An unreachable source, a 404, a wrong header or missing columns is recorded as an error for that unit, never as an empty success.
- **One at a time.** A run holds a database lock (`stormLocks`, 15 minute expiry, refreshed as it works) and a second start is rejected. A run that stops heart-beating (the server was killed) is marked failed on the next look, and the next run continues from its unfinished units.
- **Audited.** `storm.import_started` and `storm.import_finished` are written to the audit log.

## Starting imports
From the page: **Run backfill** (NCEI years, default 2009 to now), **Import range** (SPC dates) or **Sync recent days now**. By API (administrator):

```
POST /api/v1/storm/imports/backfill   { "fromYear": 2009, "toYear": 2026, "force": false }
POST /api/v1/storm/imports/spc        { "from": "2026-07-01", "to": "2026-11-09" }
POST /api/v1/storm/imports/daily      {}
GET  /api/v1/storm/imports            progress, per-source coverage, last successful sync, recent runs and their errors
```
Imports run in the background and return `202`. The page refreshes by itself while one is running.

**To load the history in a new environment:** sign in as an administrator, open Storm data imports, press **Run backfill** (first year 2009). Expect many minutes: each year is a 10 to 15 MB download. Then run **Import range** for the last four months, because NCEI lags real time by 2 to 4 months and SPC covers that gap. Leave the server running; the scheduler takes over.

## Scheduler (no extra infrastructure)
A timer in the API process (`startStormScheduler`) runs a daily sync about every hour: the last three SPC report days, then the current NCEI year if its file version changed, then the new-event alert check and the past-customer scan. It starts 30 seconds after the server starts. Environment:

| Variable | Default | Meaning |
|---|---|---|
| `STORM_SYNC_ENABLED` | on | `false` turns the scheduler off |
| `STORM_SYNC_INTERVAL_MINUTES` | 60 (minimum 15) | how often it runs |
| `STORM_FOLLOWUP_RADIUS_MILES` | 3 | radius for past-customer matching |

The scheduler does not run under tests. If you run more than one API instance the lock keeps them from importing at once.

## What happens after new events arrive
Events that were newly inserted, qualify and have a point are passed to the alert step (`storm.alerts.ts`). Only events from the last 3 days can alert, so a historical backfill never sends a flood of alerts.

## Failure handling summary
| Situation | Result |
|---|---|
| NOAA unreachable / HTTP 5xx | the unit fails with the message; other units continue; the run is `completed_with_errors` or `failed`; the CRM keeps working with the data it has |
| HTTP 404 | the unit is `unavailable` ("not published"), counted separately |
| HTML or a changed header instead of CSV | rejected with "does not have the expected header" / "missing expected columns"; nothing is imported from it |
| Truncated download | the stream errors, the unit fails; rows already written are valid and a retry is idempotent |
| Row with a bad id, date or number | counted as `invalid` and skipped |
| Row without coordinates | stored with county-level or no precision, never with an invented point |
| Server restart mid-run | detected as stale; start again to continue |
