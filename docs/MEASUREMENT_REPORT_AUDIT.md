# Measurement report audit (before the quality upgrade)

Inspected: the Legacy report `b96b9a5f-…pdf` (13 pages, 1532 Rebecca Lane, Lancaster TX) and the reference report for the same address. The reference is only used for structure and presentation; nothing from it is copied.

## Why the Legacy report falls short
| Area | Finding | Cause in code |
|---|---|---|
| Page 1 | Image small, summary cramped, no north indicator on the image | `solar.report.ts` fixed 300 pt box, stat cards share one row |
| Diagrams | Small, floating in a frame with empty bands; facet outlines jagged (F9, F10, F11); labels collide | SVG drawn at 900x640 with its own title/legend inside a fixed-height box; no label collision handling; polygons only Douglas-Peucker simplified |
| Lengths page | No per-category totals above the diagram; types with no edges omitted; lengths in decimal feet | table built from derived edges only |
| Area page | "Unspecified", two-story and two-layer values missing | not modelled |
| Waste | One combined table | `wasteTable` single list |
| Materials | Generic assumptions (3 bundles per square, 10 ft pieces), no product families, one waste column, edge-based items computed from unverified edges | `materials.ts` default rules, `unverified` still gave quantities |
| Photos | A page of "Not provided" labels | one section per category always printed |
| Tables | Columns left aligned, numbers not right aligned, text clipped without ellipsis control, no continuation handling | fixed-width `row()` helper |
| File name | `roof-measurement-RM-….pdf`, inline | route uses the stored name |
| Data checks | None: totals were not reconciled before printing | no validation step |

## What is kept
Google Building Insights and Data Layers integration, the geometry pipeline, edge review and history, measurement revisions, file storage, estimate workflow, company scoping. Provider values are never changed to match another report: the Legacy report showed 3,059 sq ft and 11 facets because Google and the other provider measure differently (different imagery date, segmentation and rounding); that difference is disclosed, not corrected.

## Plan
1. Geometry: merge tiny facets instead of dropping them, clean thin spurs, snap near-axis and near-45 degree edges so outlines are crisp (area still comes from Google).
2. Diagrams: bare vector diagrams sized to the page, label placement with collision avoidance, edge labels by priority, feet and inches.
3. Report engine: consistent header, footer and column-aligned tables with continuation pages; ten standard pages; compact photo appendix.
4. Waste: separate pitched and flat tables, configurable recommended percentages.
5. Materials: company product catalog (brand, unit, coverage, confirmed or not) per family; generic rows only when no product is configured and labelled as such; only verified inputs produce quantities.
6. Validation of totals before printing, reported on the notes page.
7. Address-based, revision-aware download file name with a UTF-8 Content-Disposition.
