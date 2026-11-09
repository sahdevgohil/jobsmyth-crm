# Integrations

Honest status as of the current codebase. **Adapters exist; live provider calls are not claimed.**

| Integration | Status | Env / credentials | Supported operations | Limitations / remaining work |
|---|---|---|---|---|
| **Roofr** | Adapter boundary only (`not_configured`) | Pending provider credentials | Measurement import stub | No live API verification |
| **Dropbox Sign / DocuSign** | Adapter boundary only | Pending | Signature request stub on proposals | No live e-sign |
| **QuickBooks Online** | Adapter boundary only | Pending QBO app + tokens | Invoice/payment sync stub | No live sync; finance remains CRM-local |
| **Resend (email)** | `not_configured` | Resend API key (not wired) | `sendEmail` returns `not_configured` | Forgot-password / portal reset do not send mail; communications persist honest status |
| **Twilio (SMS)** | `not_configured` | Twilio SID/token/from (not wired) | `sendSms` returns `not_configured` | Same honesty rules as email |
| **S3 / R2** | Not configured | Would need bucket + keys | Local filesystem via `FILE_STORAGE_DIR` | Production object storage still open |
| **Sentry** | Not configured | DSN | — | Error monitoring deferred |
| **Website lead intake** | API ready | `WEBSITE_LEAD_INTAKE_SECRET` | `POST /api/v1/public/website-leads` | Live website form wiring blocked on Q-006 |

## Email / SMS honesty rules

- Never show UI or API as `sent` / `delivered` when the adapter returns `not_configured`.
- Communications module stores the adapter result on each attempt.
- Proposal/invoice “send” paths use the same adapters.

## Signature honesty rules

- Signature provider adapter does not claim completion without a real provider response.

## Accounting honesty rules

- QBO adapter does not mark invoices synced without a successful provider call.

## Storage

- Default: local directory `FILE_STORAGE_DIR` (see `.env.example`).
- Files are served only through authenticated API routes; portal only sees `visibility: customer` files for the session customer.


## Google Solar API (roof measurements)

| Item | State |
|---|---|
| Purpose | Address-based roof area, pitch, orientation and segment data |
| Credentials | `GOOGLE_SOLAR_API_KEY` in the backend environment only |
| Status | Reported as *Connected* only after a successful real authenticated request for the current key (Measurements > Integration & usage > Test connection); the Integrations page shows the same state. A real test and a real measurement succeeded on 2026-11-06 with the project key |
| Endpoints used | `buildingInsights:findClosest` (area, pitch, segments), `dataLayers:get` with `view=IMAGERY_LAYERS` (RGB, DSM, building mask GeoTIFFs, downloaded server-side at once), Geocoding API `maps.googleapis.com/maps/api/geocode/json`. Flux and shade layers are not used |
| Does not provide | Edge lengths and roof outlines: derived by the CRM from the DSM and building mask (`docs/MEASUREMENT_UPGRADE.md`), estimates until a person verifies them |
| Fallback | Manual measurement, uploaded report, retry later |
| Setup | `docs/GOOGLE_SOLAR_SETUP.md`; workflow `docs/MEASUREMENT_WORKFLOW.md` |

EagleView, HOVER and Roofr are **not** used and no paid measurement API is required. The EagleView developer page could not be read (it renders client-side), so no EagleView adapter was written; nothing was assumed about its endpoints.
