# Offline field mode and sync

## What works offline
Field mode (`/app/field`) can open, start, edit and save a form with no connection, capture photos and a signature, and queue everything for upload. Data is written to IndexedDB (`legacy-field`: drafts, photos, templates, contacts) **before** anything is sent, so closing the browser loses nothing.

## PWA
`public/manifest.webmanifest`, `public/sw.js` (registered in production builds only), icons in `public/icons`. The service worker caches the app shell and static assets. **API responses are never cached.** Navigation falls back to the cached shell when offline.

## Opening the app offline
The access token lives in memory, so a cold start offline cannot restore the real session. After a successful sign-in, a non-secret profile (name, role, permissions; no tokens) is kept in localStorage. If the refresh call fails because the **server is unreachable** (not because the session was rejected), the app opens an *offline session* limited to `/app/field`. Signing out removes the profile. When the connection returns, the next API call refreshes the real session through the cookie.
Consequences: a device that was never signed in online cannot use field mode, and templates must have been downloaded once while online (Field mode downloads all published templates when it loads).

## Sync protocol
`POST /forms/sync` (one call per submission, always HTTP 200 with a per-item status): `created | updated | unchanged | completed | conflict | invalid`.
- **Duplicate protection**: the submission `clientId` (UUID, unique per company) and each photo's own `clientId` (partial unique index per submission). A retry after a lost response stores nothing twice.
- **Conflict detection**: `baseRevision` against the server `revision`. A stale device never overwrites newer server data; the device keeps its copy and the user chooses *Keep my version* or *Use the server version*.
- **Order**: submission, then photos, then completion with the signature file id substituted for the local placeholder.
- **Retry**: failed drafts stay queued. Sync runs on the `online` event, on page load, and with "Sync now". A network error stops the run and keeps every byte.
- Nothing local is deleted until the server confirmed it. Synced drafts can be removed manually.

## Status UI
Header pill ("Offline - n unsynced", "Syncing...", "n unsynced"); Field mode list with per-form status (Saved on this device, Waiting to sync, Syncing, Synced, Sync failed, Conflict); per-photo badge (On device / Synced / Retry); a warning not to clear the browser while forms are unsynced.

## GPS
Optional. Photos and address pins request the device location with a short timeout; a denial never blocks capture.

## Limits
- Customer intake needs the server (it creates customer, property and lead in a transaction) and is **not** offline-capable.
- Device storage is not encrypted; rely on the device lock.
- The `contacts` store exists but offline customer search is not built; offline forms are saved unlinked and can be linked after sync.
- iOS Safari may evict IndexedDB for sites that go unused for a long time. Sync soon after fieldwork.
- Tested: unit tests (restart persistence, offline then online, lost response, conflict, signature, invalid completion), API sync tests, and a Playwright journey that goes offline, edits, saves, reconnects and auto-syncs. **Not tested**: real phones in airplane mode, service-worker cold start offline in a production build, background sync (not used).
