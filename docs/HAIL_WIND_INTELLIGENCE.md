# Hail & wind intelligence

Reported hail (1.00 inch or larger) and wind (over 50 mph) from NOAA, searchable by address, shown on a map, grouped into work zones, tied to leads, customers, properties and jobs, and used for territory alerts. Sources and formats: `NOAA_DATA_SOURCES.md`. Importing: `STORM_DATA_INGESTION.md`. Accuracy rules: `STORM_GEOGRAPHIC_ACCURACY.md`.

**Nothing here is demo data.** No storm records are seeded; the screens are empty until an administrator imports NOAA data. Tests use real NOAA sample files through a mocked network.

## Pages (sidebar group "Storm intelligence")
| Page | Route | Permission |
|---|---|---|
| Hail & wind search | `/app/storm` | `stormEvents:search` |
| Storm map | `/app/storm/map` | `stormEvents:read` |
| Work zones | `/app/storm/zones` | `stormZones:read` (manage: `stormZones:manage`) |
| Storm alerts (rules, history, past-customer follow-ups) | `/app/storm/alerts` | `stormAlerts:read` (rules: `stormAlerts:manage`) |
| Storm data imports | `/app/storm/imports` | `stormEvents:import` |

A **Storm history** panel is on customer, property, project (tabs) and lead pages. Administrators have every permission; salespeople have `stormEvents:read`, `stormEvents:search`, `stormZones:read`, `stormAlerts:read`. Salespeople see only their assigned zones, alerts sent to them and flags on their own customers.

## Search
Address, radius 1, 3, 5 or 10 miles, optional dates, hail/wind/both, minimum hail and wind (cannot go below the thresholds), source, and **date of loss**. Results show date, time, type, size or speed, distance, direction, location, county, state, source and precision, sorted nearest, newest or largest, with a map and a summary (reports, largest, storm days). A date of loss adds three cards: day before, **date of loss** (highlighted), day after. County-only reports appear separately as regional context. Address lookup: Google Geocoding (rooftop where Google can) using the server key, or the free US Census geocoder; results are cached 30 days; ZIP/city-level matches are refused.

## Map
Leaflet with OpenStreetMap tiles and marker clustering. Hail is a circle, wind a diamond, sized by magnitude; click for details (source, precision, narrative). Reports load for the visible area only (capped at 1,500 largest, with a "showing N of M" notice). Filters match search; work zones can be overlaid; "Go to address" centres the map. Alert links open the map on the event.

## Work zones
Radius zones, drawn areas (click corners on the map) and county zones (API). Each has dates, minimum hail and wind, notes and a representative; every reassignment is kept with who and why. Ranking by largest hail, highest wind, most reports, most recent storm, or a **combined score** with adjustable weights. The score and its parts are shown for each zone (`how the score is calculated`). Zone figures: hail and wind reports, storm days, maximum hail and wind, latest event, and CRM counts of customers, past customers and leads. CRM counts use properties with a saved location (a lead is counted when its address matches such a property); the page says how many leads could not be placed. Assigning a zone creates no leads or customers.

## Alerts
A rule watches one zone: hail ≥ threshold (floor 1.00 in), wind > threshold (floor 50 mph), an extra radius around the zone, recipients (zone representative, administrators, named users) and channels. When newly imported qualifying events from the last 3 days fall in the zone, each rule alerts **once per event** (unique `(rule, event)`). In-app notifications work now. **Email and SMS are not configured** (the existing adapters report `not_configured`), so the history records `not_configured` for those channels and nothing is claimed as sent. Wiring a provider into `services/email` or `services/sms` makes them deliver without changing the alert code.

## Past customers
A completed job (with a saved property location and a completion date) gets a flag when a qualifying report happens **after** completion within the radius (default 3 miles, up to 10). One flag per job and event; a dismissed flag is not recreated. Wording: "Nearby storm activity detected after completed roof work — follow-up may be appropriate." Actions: review, dismiss, create a follow-up task, call reminder or note (normal customer activities). A scan runs after each scheduled sync and on demand.

## Configuration
| Variable | Purpose |
|---|---|
| `GOOGLE_SOLAR_API_KEY` | also used (server side only) for Google geocoding; enable the Geocoding API on the key |
| `STORM_GEOCODER` | `auto` (Google if a key is set, else Census; default), `google`, `census`, `none` |
| `STORM_MAP_TILE_URL`, `STORM_MAP_ATTRIBUTION` | tile server for the map (default OpenStreetMap; follow its usage policy or use a commercial tile provider for heavy use) |
| `STORM_SYNC_ENABLED`, `STORM_SYNC_INTERVAL_MINUTES`, `STORM_FOLLOWUP_RADIUS_MILES` | scheduler (see ingestion doc) |
| Email / SMS | not wired; set up in `services/email` and `services/sms` when providers are chosen |

No key reaches the browser; the status page tells the browser only which provider is active.

## API and data
`API.md` (Storm intelligence and Pipeline sections), `DATABASE.md` (new collections and indexes), `INTEGRATIONS.md`.

## Limits
- Reports, not damage; see the accuracy document.
- History starts from what has been imported. NCEI is imported from 2009; SPC covers recent days and any range an administrator imports. Until the backfill shows complete, older years may be missing.
- MRMS radar hail estimates are not included.
- Time-of-day is standard time estimated from longitude.
- Drawn zones cannot span more than about 6 degrees. CRM counts are not available for county zones.
- The map uses free OpenStreetMap tiles by default.
