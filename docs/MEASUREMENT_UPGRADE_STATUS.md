# Professional measurement upgrade: status

Complete for this session. Details: `MEASUREMENT_UPGRADE.md`.

## Completed and tested
Data Layers integration, GeoTIFF decoding, footprint and facet extraction, DSM-based edge classification with manual review and history, SVG diagrams, aerial image, 11-12 page branded PDF, field photos, waste (8 scenarios), configurable material rules, estimate quantity pre-fill from verified edges, measurement workspace UI (tabs, edge table, photos, materials, corrections), usage ledger and settings for Data Layers, revisions and company isolation.
Tests: backend 108 in `solar/` plus the rest of the suite; frontend unit tests; Playwright `roof-measurement.spec.ts` (12 passed, mock Google).
Real Google: connection test, Building Insights, Data Layers, geometry, aerial image and PDF verified on two real addresses (see MEASUREMENT_UPGRADE.md).

## Final PDF quality upgrade
Audit: `MEASUREMENT_REPORT_AUDIT.md`. The report is now a Legacy-branded, address-named PDF of about 11 to 13 pages: overview with aerial image, roof diagram, length report (11 edge types, colour coded, derived edges dashed and marked), area report, pitch and direction, structure summary, additional structures (outline only, excluded from totals), combined summary, separate pitched and flat waste tables, product-specific material calculations from an admin catalog, field photographs (only when photos exist) and a notes/data-checks page. Header with logo and website, and a footer with report number, revision, date, page x of y and Google attribution, appear on every page. Tables continue on new pages with the header repeated; text is never shrunk. Diagrams are vector, with label collision avoidance and leader lines. Validation (`report/data.ts`) runs before every report and prints any inconsistency on the notes page instead of changing a value. No source measurement is altered: Google values are shown as received and the difference to other providers is disclosed in the notes.
Tests added: filename and header generation, ft/in, report validation, PDF page integrity (header/footer on every page, page x of N), missing imagery, multiple structures, multiple photos, no-photo notice, product-specific packages, unverified edge exclusion, flat/pitched waste, revision name, the PDF layout kit with a 140-row table, catalog CRUD, permissions and company isolation.

## Partial / limits
- Edge lengths and facet outlines are estimates; no accuracy figures against ground truth. Flat, treed and complex roofs are weak.
- One building per Building Insights request; other structures are outlines only.
- Imagery storage beyond a short retention window is not assumed permitted (terms not stated on the pages that could be read).
- Aerial overlay uses the mask outline, not individually traced rooflines.
- Dormers, skylights, chimneys and parapets are not auto-detected (counts are entered by staff).

## Exact next task
Collect 10-20 known roofs (gable, hip, complex) with tape-measured edges, run `scripts/measure-real.ts` on them, and record per-edge-type error to set honest confidence thresholds. Then review Google's storage terms and decide the imagery retention policy.

- Product coverage numbers in the demo catalog are placeholders (`specConfirmed: false`, asterisked in reports); administrators must enter supplier specifications.
- Two-story and two-layer areas are printed as "Not available": Google does not provide them.
- Footprint outlines of nearby structures are not shown on the roof diagram page; they are on the additional-structures page.
