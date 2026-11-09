# Pipeline dashboard and hail & wind intelligence: status

Date: 2026-11-10. Related: `PIPELINE_DASHBOARD.md`, `PIPELINE_FINANCIAL_RULES.md`, `HAIL_WIND_INTELLIGENCE.md`, `NOAA_DATA_SOURCES.md`, `STORM_DATA_INGESTION.md`, `STORM_GEOGRAPHIC_ACCURACY.md`.

## Done (backend, frontend, data handling, permissions and tests)
- Pipeline: six stages, one authoritative calculation module, stage history with audit, estimate accept / deny / reopen, proposal sync, project and invoice hooks, manual exception moves, change orders, history "as of", backfill of existing jobs, dashboard page with drill-down, filters and denied view.
- NOAA: SPC daily hail and wind adapter; NCEI Storm Events (2009 onward) adapter; idempotent, resumable, streamed ingestion with locking and honest status; hourly in-process scheduler.
- Search by address (1/3/5/10 miles, date of loss, filters), map with clustering, zones (radius, drawn, county) with ranking and assignment history, alert rules with de-duplicated delivery, past-customer follow-up flags with tasks, storm history on customer, property, project and lead pages, admin import screen.

## Not done / external
- A real import of NOAA data has **not** been run from this environment into the client's database: tests use real sample files through a mocked network. Historical years imported on the client system: none yet.
- Email and SMS delivery: providers not configured (alerts record `not_configured`).
- MRMS radar hail: not integrated (clean provider boundary exists).
- Google geocoding needs the Geocoding API enabled on the existing key; otherwise the free US Census geocoder is used.
- Older Playwright specs that need a MongoDB replica set (lead conversion, intake) cannot pass against a standalone MongoDB.

## Next steps for the client
1. Start MongoDB as a replica set (`backend/scripts/start-dev-mongo.ps1`) and run the API.
2. Sign in as an administrator, open **Pipeline**, press **Import existing jobs**.
3. Open **Storm data imports**, press **Run backfill** (2009 to now), then **Import range** for the last four months. Confirm the page reports every year imported.
4. Create work zones, assign representatives, add alert rules. Set `GOOGLE_SOLAR_API_KEY` (Geocoding API enabled) or leave `STORM_GEOCODER=auto` for the Census geocoder.
