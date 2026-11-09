# Google Solar setup

No live Google request has been made by this project's automated tests (they use deterministic fixtures). The CRM reports **Connected** only after a real request to Google succeeds from your server.

## 1. Google Cloud
1. Create or choose a Google Cloud project and **enable billing** (Google requires a billing account and payment method even within the free allowance).
2. Enable **Solar API** and **Geocoding API** (APIs and Services > Library).
3. Create an **API key** (APIs and Services > Credentials). Restrict it:
   - API restrictions: Solar API and Geocoding API only.
   - Application restriction: IP addresses, your server's outbound IP. (Not "HTTP referrers": the key is used by the backend, never the browser.)
4. In Billing, set a **budget and alerts**. In Quotas, lower per-minute and per-day caps if you want a hard ceiling.
5. Check the current free usage allowance and price per 1,000 requests on the Solar API pricing page (SKUs: *Solar API Building Insights* and *Solar API Data Layers*; the project brief assumes 10,000 and 1,000 free requests a month, which you must confirm).

## 2. CRM server
In `backend/.env` (never commit it):

```
GOOGLE_SOLAR_API_KEY=your-key-here
```
Restart the backend. The key is read only by the server, is never returned by any endpoint, and is not part of the frontend build.

## 3. Verify
Sign in as an administrator, open **Measurements > Integration & usage**, press **Test connection**. It sends one real Building Insights request to Google's sample location (37.4450, -122.1390), requires the response to contain roof segment data, saves no measurement, and stores the sanitized result (time, HTTP status, code).

States: **Not configured** (no key in the server environment), **Configuration required** (key set but not tested, or the key changed since the last test), **Connected** (the last test succeeded for the current key), **Connection failed**, **Quota exceeded**, **Turned off**. Changing or removing the key invalidates an earlier result until a new test passes. The same status is shown on **Integrations**.

Failure messages and fixes: API not enabled (enable "Solar API", solar.googleapis.com, in the key's own project), billing disabled (link a billing account), key restricted (allow the server's outbound IP and include Solar API and Geocoding API under API restrictions), key invalid (copy it again into backend/.env), quota exceeded, timeout, network, unexpected response.

Command-line check (prints only sanitized results, never the key): `npx tsx --env-file=.env scripts/check-google-solar.ts` from `backend/`.

Environment: the dev server reads `backend/.env` through `--env-file=.env` (start it from `backend/`, e.g. `npm run dev -w backend`). If nothing was loaded, the server also loads `backend/.env` by its absolute path. After editing `.env`, **restart the backend**: `tsx watch` reloads on source changes, not on `.env` changes.

## Data Layers (aerial imagery and roof outlines)
Each measurement also makes one Data Layers request (RGB, DSM and building mask) when **Fetch aerial imagery and roof outlines** is on. Data Layers is a separate Google SKU with its own free allowance and price: check it on the pricing page and set its daily and monthly limits on the integration page. Turn the switch off to measure with Building Insights only.

## 4. Tune
On the same page set the daily limits, monthly allowance, warning percent, whether to continue past the allowance, preferred imagery quality (HIGH with BASE fallback), reuse window and retention, and optionally the price per 1,000 requests so the page can estimate overage.

## Google terms you must follow
Use roof data only as the Solar API terms allow, keep the attribution ("Roof data: Google Solar API. (c) Google.") visible on screen and in reports, do not embed Google imagery in reports unless the terms allow it (this module does not), and review the caching/storage rules in the Google Maps Platform terms before keeping data long-term. The setup pages available during development did not state the caching rules, so this is an open item.

## Coverage
Google Solar does not cover every address and imagery quality varies (HIGH, MEDIUM, BASE). When there is no data the CRM says so and offers manual entry; it never fills gaps.

## Running the browser test
`backend/scripts/e2e-solar-server.ts` starts a **test-only** API whose Google calls return fixtures. It refuses to run unless `NODE_ENV=test` and `E2E_MOCK_GOOGLE=1`, and the mock hook is disabled outside `NODE_ENV=test`.
```
NODE_ENV=test E2E_MOCK_GOOGLE=1 PORT=4100 CORS_ORIGINS=http://localhost:5180 MONGODB_URI=<throwaway db> npx tsx --env-file=.env scripts/e2e-solar-server.ts
VITE_API_URL=http://localhost:4100/api/v1 npx vite --port 5180
E2E_BASE_URL=http://localhost:5180 npx playwright test e2e/roof-measurement.spec.ts
```
Seed the throwaway database first (`npm run seed:demo -w backend` with `MONGODB_URI` pointing at it).
