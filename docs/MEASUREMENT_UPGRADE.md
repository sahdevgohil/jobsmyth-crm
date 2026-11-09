# Professional roof measurement upgrade

Builds on `MEASUREMENT_WORKFLOW.md` (Building Insights, area, pitch, revisions). This upgrade adds Google **Data Layers** imagery, a roof geometry pipeline, edge review, field photos, materials and a multi-page branded report.

## Data flow
1. Building Insights (as before): segments with area, pitch, direction, centre and bounding box.
2. Data Layers (`dataLayers:get`, `view=IMAGERY_LAYERS`): links to RGB, DSM (elevation) and building-mask GeoTIFFs. Radius and pixel size are sized to the building (30-90 m; 0.1, 0.25 or 0.5 m pixels). Flux and shade layers are never requested.
3. The three files are downloaded immediately on the server (https and `solar.googleapis.com` only, key added server-side, 40 MB cap, timeout, retry on 5xx/429/network). The expiring links are never stored or sent to the browser.
4. Decoded with `geotiff` and `proj4` (plain Node, no Python or extra service). Rasters must align and use a UTM CRS.
5. Geometry is derived and stored in `measurement.geometry`. The Google data in `measurement.automated` is never modified.

Cost per measurement: 1 Building Insights request (2 if HIGH imagery is missing and BASE is tried) + 1 Data Layers request. Both are counted separately in the usage ledger, with their own daily and monthly limits, and each measurement lists the calls that made it (`automated.apiCalls`). Cached measurements make no new requests; "Refresh imagery" makes one Data Layers request.

## Geometry method (`solar/geometry`)
- **Footprint**: building mask, closed/opened to remove noise, 4-connected components; the component nearest the building centre is the main structure. Outline traced from pixel edges and simplified (Douglas-Peucker, 0.3 m).
- **Facets**: every roof pixel is assigned to the Google segment whose plane (pitch and direction from Google) best matches the local DSM slope and whose bounding box is near. A majority filter and largest-piece rule clean the label map; outlines are traced per facet. Area, pitch and direction shown for a facet are Google's, not measured from the outline. Each facet records how well its outline size agrees with Google's ground area (`agreement`); below 0.6 it is marked approximate.
- **Edges**: each outline segment is classified from the DSM height profile across it (ridge/hip = interior maximum, valley = interior minimum), or, on the footprint edge, as eave/rake/flashing candidate from the facet's downhill direction and the height of the neighbouring surface. Lengths are sloped (true) lengths. Flat-roof perimeters, steps and adjoining higher surfaces are left as unspecified/flashing candidates marked **Needs verification** with no stated length.
- **Structures**: other mask components are listed as additional structures with a footprint only. Google returns roof segments for one building per request, so their roof area is not measured and is excluded from totals.
- **Missing or failed imagery**: the measurement is kept; the geometry status is `unavailable` with the reason, diagrams switch to a dashed, loudly labelled approximate view, and the PDF shows "Aerial imagery not available". A failed refresh never overwrites good geometry.

## Trust model
Derived edges start `unverified` (confidence `medium` at best, never `high`) or `needs_verification`. Only edges that a person verified, or entered by hand, count toward the ridge/hip/valley/eave/rake totals used by estimates and material orders. Every change is logged on the edge (who, when, field, old and new value, reason). "Verify all" never includes uncertain edges. Labels used everywhere: Automatically derived, Calculated, Manually entered, Field verified.

## Diagrams and report
Vector SVG from the same geometry for the web page and the PDF (`svg-to-pdfkit`): outline, facets, area, pitch and direction, edges (colour-coded, lengths, legend, north arrow, scale bar). The aerial image is a derived PNG with an SVG overlay (building outline, facets, property pin), labelled as aerial imagery, not an inspection photograph, with Google attribution.
PDF pages: Roof Overview, Roof Diagram, Length Measurement Report, Area Measurement Report, Pitch and Direction Report, Individual Structure Summary, Additional Structures (only when present), Combined Report Summary, Waste Calculations, Material Calculations, Field Photographs, Notes/Sources/Verification. Waste scenarios: 0, 5, 10, 12, 14, 15, 17, 20%, selected one highlighted.

## Materials
`solar/materials.ts`. Rules (packaging coverage, waste on/off) are configurable per company in the integration settings; the built-in defaults are generic assumptions (for example 3 bundles per square, 10 ft drip edge pieces) and are labelled as such, not as your products. Quantities are exact, then rounded up to whole packages. A material that needs an edge total that is missing shows "Missing" instead of a guess; unverified inputs are flagged. Prices are never calculated here.

## Field photos
`POST /measurements/solar/:id/photos` with a category (aerial overview upload, four elevations, roof slopes, damage close-ups, penetrations, gutters, flashing, interior damage, other), notes, related item, capture time and optional GPS. Stored as company-scoped files; verification status per photo; categories with no photo print "Not provided". Google aerial imagery is never listed as a field photo.

## Estimates
Estimate pre-fill uses base squares, pitch and the catalog quantities that can be derived from verified edges (drip edge and starter from eaves + rakes, hip and ridge cap, step and headwall flashing, pipe boots, vents, chimney kits). Unverified suggestions are offered with a button, never applied silently. The estimate records the measurement id and revision; a new revision never changes it.

## Google terms
Attribution follows the Solar API policy page: "Source: Includes solar data from Google" next to the data and imagery, and "Includes data from Google Maps" for derived content, on screen and on every PDF page. The policies page does not state caching or storage rules for Solar data and the Service Specific Terms page could not be read, so **permanent storage of imagery was not assumed**: the derived aerial PNG is kept only for `imageryRetentionDays` (default 30; 0 = never stored), Data Layers links and GeoTIFFs are never kept, raw Building Insights responses expire after `rawRetentionDays`. Derived measurements, geometry and edges are kept as the company's records. Have the terms reviewed before extending any retention.

## Real-world check (not a validation)
Run against live Google with the project key on 2026-11-06:
- 4302 Avenue D, Austin TX (small tree-covered building): geometry `ok`, 8 facets, 26 edges, 933 sq ft, 12-page PDF. Google measured the building closest to the pin, which was a small structure partly hidden by trees; the report image makes that visible, and the UI tells the user to confirm the red outline.
- 2101 Rio Grande St, Austin TX (large commercial roof): 17,695 sq ft, 50 segments, 7 neighbouring structure outlines, 16-page PDF. Facet outlines were mostly approximate (flat roof with equipment), most edges `needs_verification`, and the report said so.
The outlines and aerial overlay lined up with the buildings in the imagery. Accuracy of edge lengths against ground truth was **not** measured. Expect usable results on simple gable and hip roofs, weaker results on flat, heavily treed or complex roofs.

## Limits
- No measured accuracy figures; edges are estimates until verified.
- Mixed stories, dormers, skylights, chimneys and parapets are not separately detected.
- One building per Building Insights request.
- Edge totals feed estimates only after verification.
- Imagery needs one Data Layers request per measurement; coverage depends on Google.
