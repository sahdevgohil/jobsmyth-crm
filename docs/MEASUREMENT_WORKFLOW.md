# Roof measurement workflow (Google Solar)

An authorized user enters an address, the CRM asks the Google Solar API for roof data, normalizes it, shows it, produces a branded PDF, and pre-fills a Good/Better/Best estimate. Nothing is invented: whatever Google does not provide is shown as "manual measurement required".

## What Google provides, and what it does not
| Provided by Google Solar (Building Insights) | Not provided |
|---|---|
| Roof segments: area (m2), pitch (degrees), azimuth (degrees), centre, **bounding box**, plane height at centre | Ridge, hip, valley, eave, rake lengths |
| Imagery date, processing date, quality (HIGH / MEDIUM / BASE) | Roof segment **outlines/polygons** |
| Whole-roof area (used as a cross-check) | Stories, layers, decking, penetrations, skylights |

Data Layers (DSM/RGB/mask GeoTIFF links, valid one hour) are wrapped by the adapter (`getDataLayers`, `retrieveAvailableImagery`) but not used automatically: converting rasters into roof outlines is not implemented, so edge lengths stay manual. Geocoding (Google Geocoding API) only locates the address; it is never treated as a measurement.

## User flow
1. **Measurements > Measure from address** (`measurements:order`).
2. Type an address. *Search CRM* is free. *Look up address (Google)* costs one geocoding request and returns up to 5 candidates, flagged precise or approximate.
3. Pick an existing property, or pick an address match and choose the customer. An existing property with the same address (address key, or street + ZIP) is reused, never duplicated. Approximate pins require an explicit confirmation.
4. **Get roof measurements**: one Building Insights request at the preferred quality (default HIGH). If Google reports no imagery at that quality (404) and fallback is on, BASE is tried once. Any other error stops immediately.
5. The measurement opens: summary, segment diagram, tables, edges, waste table, corrections, PDF, estimate button.
6. **Create Good / Better / Best estimate** opens the quote builder pre-filled (base squares, pitch) and lists what you must still enter. The estimate stores the measurement id and revision.

If Google cannot help (not found, quota, billing, key problems, limits, timeouts) nothing is saved and the page offers: manual entry, uploading an existing report on the property, or trying again.

## Calculations (`modules/measurements/solar`)
- m2 to sq ft: x 10.7639104167. 1 roofing square = 100 sq ft. m to ft: x 3.28084.
- Pitch: `12 x tan(degrees)`, rounded to a conventional `N/12`; the exact ratio and degrees are kept.
- Roof area = sum of segment areas (roof surface, already pitch-adjusted by Google). A >5% difference from Google's whole-roof area adds a warning.
- Pitch distribution groups segments by rounded pitch with area and percent. Orientation = compass direction with the most area.
- **Waste** (0, 5, 10, 12, 15, 20%) is applied once to the base area. It is for material ordering; **the customer catalog shingle rates already include waste**, so the estimate uses base squares.
- Edge classification (`edges.ts`) can classify ridge/hip/valley/eave/rake from real plane polygons using adjacency, slope and azimuth, with true sloped lengths. It never reports "high" confidence and flags ambiguous edges. Google's response has no polygons, so for Google results every edge is `manual_required`. The classifier is tested on synthetic gable, hip and valley roofs only.

## Provenance and corrections
Every figure is tagged **Google Solar**, **Calculated** (pitch label from degrees), **Manually entered**, or **Manually verified**. `automated` (the imported data) is never modified. Corrections (`PATCH /measurements/solar/:id/corrections`) need a reason and log field, old value, new value, user, time, reason. Changing a verified value clears its verified flag. Editable: area, segments, pitch, ridge/hip/valley/eave/rake, pipe boots, vents, skylights, chimneys, roof layers, additional tear-off, chimney details, notes.

## Revisions
A forced re-measure creates revision N+1 (`supersedesId`), the previous record is marked superseded and left untouched. Older revisions are read-only. Estimates keep `pricingSource.measurement {id, revision, source, area, pitch, verified}`, so a later re-measure never silently changes an issued estimate or proposal.

## PDF report
Branded (logo, red rule, company contact), report number `RM-yyyy-XXXXXX-Rn`, customer, address, source, imagery date/quality, summary, pitch breakdown, segment table, edge table with status labels, segment diagram (bounding boxes, labelled as simplified, **no imagery**), waste table, staff-entered features, notes and warnings (missing data, corrections), the required disclaimer, and "Roof data: Google Solar API. (c) Google." in the footer of every page. Stored as an internal `File` linked to customer and property. Demo records print "DEMONSTRATION DATA".

## Cost control
Per-company ledger of every outbound request (`solar_requests`). Controls: daily hard limit per request type, monthly free allowance (configurable), warning percent, optional overage, reuse of a recent measurement for the same property (default 30 days), serialization of concurrent runs for the same property, per-user rate limit (20/min), raw response retention (default 30 days, then dropped). The usage page shows counts, percent of allowance, and an estimated overage only if an administrator entered a price. Allowances in the defaults come from the project brief; confirm them on your Google Cloud billing page. Caching and attribution terms were not verifiable from the public pages that were fetched: derived measurements are stored as the company's records, raw responses are short-lived and GeoTIFF links are never stored. **Have the licensing/terms reviewed before relying on long-term storage.**

## Permissions
`measurements:read` view; `measurements:order` look up and measure (admin, salesperson); `measurements:update` edit; `measurements:verify` mark verified (admin, salesperson); `measurements:manage` integration settings and usage (admin only). Every record is company-scoped; salespeople see only their own customers. Customer portal users have no access.

## Demo data
`npm run seed:demo -w backend` adds 4 demonstration measurements (completed, corrected and verified, used for an estimate, large), one draft Good/Better/Best estimate built from one of them, and 12 sample ledger rows. They carry `isDemo: true`, `source: manual`, `automated.provider: demo_fixture`, are labelled in the UI and PDF, and never count toward Google limits. `seed:demo:reset` removes them.
