# Storm report geographic accuracy

A storm report says that someone reported hail or wind near a place. It does not say a particular building was hit or damaged. The CRM shows this on every storm screen and never labels a roof damaged because of a report.

## Precision categories
Stored on each event as `coordinatePrecision` and shown next to it.

| Category | Meaning | Used for distance and radius? |
|---|---|---|
| **Exact reported coordinates** (`exact`) | the source gave 3 or more decimal places (about 100 m or better) | yes |
| **Approximate coordinates** (`approximate`) | 2 or fewer decimals, about 1 km. All SPC reports, and many NCEI public reports ("2 WSW Town" turned into a point by the weather office) | yes, labelled "Approx. ±1 km" |
| **County-level location** (`county`) | no usable point, only a county (NCEI zone type C) or place | **no**. Shown separately as "regional context" with no distance |
| **No usable location** (`none`) | nothing usable | no |

County-only and location-less records get **no coordinate**: no county centroid is ever substituted, and no distance is shown for them. The geospatial index only contains records that have a source point.

## Distances
- Great-circle (haversine) distance on a sphere of radius 3,958.76 miles, computed by MongoDB (`$geoNear`) for search and by the same formula for display. Direction is the compass bearing from the property to the report.
- The property point is the property's saved location, or the geocoded address. The CRM never uses ZIP-code centroids and never uses a user's current location. If an address can only be matched at city, ZIP or "approximate" level (Google `APPROXIMATE`, partial match) the search refuses with "That address could only be matched approximately" instead of showing a distance.
- Geocoder accuracy is shown: **rooftop** (Google `ROOFTOP`), or **street-address estimate** (Google `RANGE_INTERPOLATED` or the US Census geocoder, which interpolates along the street). Rooftop is used only when Google reports it.

## Time
Report times are shown in local **standard** time, estimated from the property's longitude (offset = round(longitude / 15)). Daylight saving time is not applied. SPC times are UTC and NCEI times use the fixed offset in the file. The "day before / date of loss / day after" windows use the same offset, and the page says so. A storm near midnight can fall on a neighbouring day.

## Several reports, one storm
Many reports on one day usually describe one storm cell. Search shows "storm days" beside report counts, and zone ranking uses one value per day (the day's largest hail, the day's highest wind) in its score. Rankings that sort by report count say they count reports separately.

## Wind speed
SPC `UNK` and NCEI rows with no magnitude are stored without a speed and flagged `speed_unknown`. They never count toward the 50 mph rule and are shown only when asked ("Include wind damage reports with no speed"). NCEI knots are converted to mph with the original value kept ("63 mph (reported 55 kt)").

## What is not claimed
Not that the property was in the storm path, not that it was damaged, not that a claim is valid. Hail and wind change over short distances; a report 5 miles away is weak evidence about one roof.
