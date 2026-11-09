# NOAA data sources

Checked on **2026-11-09/10** by fetching the official pages and real files (not from memory). Source-specific parsing is isolated in `backend/src/modules/storm/providers/` so the rest of the CRM does not depend on a file layout. Real sample files used by the tests are in `backend/src/modules/storm/fixtures/`.

## 1. NOAA Storm Prediction Center (SPC) daily storm reports

| | |
|---|---|
| Official page | https://www.spc.noaa.gov/climo/reports/today.html |
| Files used | `https://www.spc.noaa.gov/climo/reports/{YYMMDD}_rpts_filtered_hail.csv` and `..._filtered_wind.csv` (SPC's de-duplicated lists). Also published: `_rpts_hail.csv` / `_rpts_wind.csv` (unfiltered), `today_*`, `yesterday_*`, torn, KML |
| Header | Hail `Time,Size,Location,County,State,Lat,Lon,Comments`; Wind `Time,Speed,Location,County,State,Lat,Lon,Comments` |
| Units (stated on the page) | Hail size in **hundredths of an inch** (175 = 1.75"). Wind in **mph**, or `UNK` when only damage was reported. Lat/Lon decimal degrees, **two decimals**. Times **UTC**, `HHMM` |
| Report day | 1200 UTC on the date in the file name to 1159 UTC the next day: a time before 1200 belongs to the next calendar date |
| Update frequency | Continuously through the day; reports are **preliminary** |
| Historical availability | Dated files exist for past days (the 2024-05-20 files were downloaded). Coverage depth was not exhaustively checked; the importer records any day SPC does not publish as *not published*, never as empty |
| Record id | None. The CRM builds a stable id from the day, type, time, value, coordinates, location and state |
| Coordinates | Every row has them; precision is about 1 km (see `STORM_GEOGRAPHIC_ACCURACY.md`) |
| Limits | In the 2024-05-20 filtered wind file, 51 of 89 rows had `UNK` speed. They are stored as *speed unknown* and never meet the 50 mph rule. Comments are free text; the first 500 characters are kept |

## 2. NOAA NCEI Storm Events Database (bulk CSV)

| | |
|---|---|
| Official location | https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/ |
| Files used | One gzip per data year: `StormEvents_details-ftp_v1.0_d{YYYY}_c{YYYYMMDD}.csv.gz`. The `c` date is the creation date and changes when NCEI adds or corrects records, so the importer reads the directory listing for the newest file of each year (the 2009 file was `c20260323`, 2024 `c20260728`, 2026 `c20261026` on the day of checking). Fatalities and locations files exist and are not used |
| Layout (51 columns, read from the real 2024 file) | `BEGIN_YEARMONTH, BEGIN_DAY, BEGIN_TIME, END_YEARMONTH, END_DAY, END_TIME, EPISODE_ID, EVENT_ID, STATE, STATE_FIPS, YEAR, MONTH_NAME, EVENT_TYPE, CZ_TYPE, CZ_FIPS, CZ_NAME, WFO, BEGIN_DATE_TIME, CZ_TIMEZONE, END_DATE_TIME, INJURIES_*, DEATHS_*, DAMAGE_PROPERTY, DAMAGE_CROPS, SOURCE, MAGNITUDE, MAGNITUDE_TYPE, FLOOD_CAUSE, CATEGORY, TOR_*, BEGIN_RANGE, BEGIN_AZIMUTH, BEGIN_LOCATION, END_RANGE, END_AZIMUTH, END_LOCATION, BEGIN_LAT, BEGIN_LON, END_LAT, END_LON, EPISODE_NARRATIVE, EVENT_NARRATIVE, DATA_SOURCE` |
| Dates | `DD-MON-YY HH:MM:SS` in local **standard** time at the fixed offset in `CZ_TIMEZONE` (`CST-6`; the file shows `CST-6` even for a daylight-time date, so the code applies the stated offset literally) |
| Event types imported | `Hail`, `Thunderstorm Wind`, `High Wind`, `Strong Wind`. Marine variants and other types are ignored |
| Magnitude | **Hail in inches.** **Wind in knots** (`MAGNITUDE_TYPE`: EG estimated gust, ES estimated sustained, MG measured gust, MS measured sustained). The knots unit was confirmed from the data: 14,787 of 19,940 thunderstorm-wind rows in 2024 are 50 to 59, the NWS 50-knot severe criterion. The CRM converts at 1.150779 mph per knot and keeps the original value and unit |
| Historical availability | Files exist well before 2009; the CRM backfills **2009 onward** as required. In the 2009 and 2024 files every Hail and Thunderstorm Wind row had coordinates and a magnitude (none county-only), but the importer handles records that lack them |
| Update frequency | Files are re-issued as data is added or corrected; recent months arrive roughly 2 to 4 months after the events |
| Record id | `EVENT_ID` (unique within the data set) |
| Limits | Not real time. Coordinates are as entered by the weather office (4 decimals for some measured reports, 2 for many public reports) |
| Usage | US government data in the public domain; the files carry no stated access restriction. The importer sends a descriptive User-Agent and downloads one year at a time |

## 3. Thresholds
Hail **≥ 1.00 inch**. Wind **> 50 mph** (strictly greater; 50 does not qualify, 51 does; 44 knots = 50.6 mph is the lowest whole knot that does). Reports below the thresholds are counted and skipped at import. They are not stored, so lowering a threshold later needs a re-import. Wind reports whose speed was not published are stored with an empty speed and `qualityStatus: speed_unknown`; they are shown only on request and are never counted toward a threshold.

## 4. MRMS
NOAA MRMS radar-derived hail estimates (MESH) are **not integrated**. The status endpoint says so. A future provider would be added beside `spc.ts` and `ncei.ts`, producing the same `NormalizedEvent` with its own `source` value.

## 5. Both sources can describe the same storm
SPC (recent, preliminary) and NCEI (later, reviewed) overlap in time. Their records are kept separately (`source`), because they have no shared id. A storm can therefore appear in both. Zone figures count **storm days** (one value per day) next to raw report counts for this reason.
