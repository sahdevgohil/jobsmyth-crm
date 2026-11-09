# Database

**Engine:** MongoDB (transactions required; local single-node replica set or Atlas)  
**ODM:** Mongoose  

## Collections (primary)

| Collection | Model | Purpose |
|---|---|---|
| `users` | User | Staff accounts (admin / salesperson) |
| `refreshSessions` | RefreshSession | Rotating refresh tokens; `principalType`: `user` \| `customer` |
| `authTokens` | AuthToken | Password reset / invite opaque tokens |
| `companySettings` | CompanySettings | Single company profile |
| `lookupValues` | LookupValue | Configurable lists (`lead_source`, `warranty_type`, …) |
| `pipelineStages` | PipelineStage | Lead/project stage configuration |
| `auditLogs` | AuditLog | Sensitive action audit |
| `leads` | Lead | Lead records + RR / intake metadata |
| `customers` | Customer | Customer master; `ownerId` for salesperson scope |
| `properties` | Property | Job sites linked to customers |
| `activities` | Activity | Notes / follow-ups / system events |
| `notifications` | Notification | In-app notifications |
| `appointments` | Appointment | Calendar appointments |
| `inspections` | Inspection | Inspection reports |
| `files` | File | Metadata + local storage pointer; `visibility` |
| `measurements` | Measurement | Roof measurements |
| `estimates` | Estimate | Estimates + line items (cents) |
| `materials` | Material | Material catalog |
| `materialRequirements` | MaterialRequirement | Project/estimate requirements |
| `proposals` | Proposal | Customer proposals |
| `projects` | Project | Production projects + tasks |
| `subcontractors` | Subcontractor | Vendor directory |
| `workOrders` | WorkOrder | Work orders |
| `invoices` | Invoice | Invoices + payments (cents) |
| `communications` | Communication | Email / SMS / internal notes timeline |
| `afterSalesRecords` | AfterSalesRecord | Completion, feedback, warranty key, follow-ups |
| `customerAccounts` | CustomerAccount | Portal login principals linked to `customerId` |

## Users

Important fields: `email` (unique, lowercase), `passwordHash` (Argon2id), `role`, `isActive`, `receivesLeads`, `mustChangePassword`, `lastLoginAt`.

Indexes: unique `email`; `{ role, isActive }`.

## Customer accounts (portal)

Important fields: `customerId` (unique ref), `email` (unique), `passwordHash`, `mustChangePassword`, `isActive`.

Ownership for portal reads is derived from `customerId` on the account — never from client-supplied IDs alone.

## Communications

Fields: `customerId`, optional `leadId` / `projectId`, `channel` (`email` \| `sms` \| `internal_note`), `direction`, `subject`, `body`, `deliveryStatus`, `provider`, `providerMessageId`, `sender`, `recipient`, `customerVisible`, `createdBy`.

Internal notes always `customerVisible: false`.

Indexes: customer/lead/project + `createdAt`.

## After-sales

Links `projectId`, `customerId`, optional `propertyId`. Optional `warrantyLookupKey` must match an active `warranty_type` lookup when set. Do not store invented warranty promises as company terms.

## Money integrity

All monetary amounts stored as **integer cents**. Aggregations for finance analytics sum cents in MongoDB.

## Archive / delete

- Customers support archive (`archivedAt`) rather than hard delete for normal workflows.
- Staff deactivation revokes refresh sessions.
- Password change / invite accept revoke other sessions for that principal.
- File delete removes metadata and local blob when using local storage adapter.

## Relationships (logical)

```
Customer 1—* Property
Customer 1—* Lead (optional conversion link)
Customer 1—0..1 CustomerAccount (portal)
Lead/Customer/Project → Activities / Communications
Estimate → Proposal → Project → WorkOrder / Invoice
Project → AfterSalesRecord
File → parent entity + visibility
```


## Roof measurement additions

`measurements` (existing) gained optional fields: `companyId`, `isDemo`, `revision`, `supersedesId`, `supersededById`, `automated` (normalised Google data, immutable after import), `fieldSources`, `verified`, `edges`, `counts`, `corrections[]` (field, original, updated, userId, at, reason), `reportFileId`; `source` and `provider` accept `google_solar`. Index `{companyId, propertyId, provider, createdAt}`.

`solar_requests` (new): usage ledger, one row per outbound Google request: `companyId`, `userId`, `kind` (geocode, building_insights, data_layers), `quality`, `latitude`, `longitude`, `status`, `errorCode`, `durationMs`, `propertyId`, `month`, `day`, `requestedAt`, `isDemo`, `rawResponse` + `rawExpiresAt` (dropped after the retention period).

`measurement_settings` (new, one per company): `enabled`, `preferredQuality`, `allowBaseFallback`, `dailyLimit`, `monthlyFree`, `warnPercent`, `allowOverage`, `pricePer1000Cents`, `cacheDays`, `rawRetentionDays`, `lastConnectionTest`.

`estimates.pricingSource.measurement` records the measurement id, revision, source, area, pitch and verification state used.


### Professional measurement additions
`measurements.geometry` (derived outline, facets, edges with per-edge history, structures, imagery metadata; the original provider data stays in `automated`), `measurements.wastePercent` (pitched, default 14) and `measurements.flatWastePercent` (default 15). `measurement_settings` also holds `recommendedPitchedWaste` / `recommendedFlatWaste`. New collection `material_products` (companyId, family, brand, name, packageUnit, coveragePerPackage, countKey, enabled, specConfirmed, sortOrder, notes, isDemo). `files` gained `measurementId`, `photoCategory`, `relatedItem`, `photoVerified`, `expiresAt` (derived aerial image expiry). `measurement_settings` gained `includeImagery`, `imageryRetentionDays`, `materialRules`. No migration is needed: all fields are optional.

## Pipeline and storm collections
- `pipelineJobs`: one per estimate lineage or project. `state`, `stage`, `stageEnteredAt`, `version`, `rootEstimateId` (unique, sparse), `projectId` (unique, sparse), `estimateIds`, `baseContractCents`, `valueSource`, `changeOrders[]`, stage dates, `manualOverride`, `history[]` (from, to, at, by, auto, trigger, reason, exception, approximate, valueCents). Money is integer cents.
- `estimates` gained status `denied`, `sentAt`, `acceptedAt/By`, `deniedAt/By`, `denialReason`, `denialNote`, `statusHistory[]`.
- `stormEvents`: `eventType`, `source`, `sourceRecordId` (**unique with source**), `eventDate`, `hailSizeInches`, `windSpeedMph`, `sourceMagnitude` + `sourceMagnitudeUnit`, `latitude`, `longitude`, `location` (GeoJSON, **2dsphere, sparse**), `coordinatePrecision`, `locationDescription`, `county`, `state`, `qualityStatus`, `qualifies`, `sourceRef`, `importedAt`, `rawSourceMetadata`. Also indexed: `(qualifies, eventDate)`, `(eventType, eventDate)`, `(state, county, eventDate)`.
- `stormImportUnits` (unique `(source, unitKey)`), `stormImportRuns`, `stormLocks`, `stormGeocodeCache` (TTL 30 days).
- `stormZones`, `stormAlertRules`, `stormAlerts` (unique `(ruleId, eventId)`), `stormFollowUpFlags` (unique `(projectId, eventId)`).
- `notifications.type` gained `storm_alert` and `storm_follow_up`.

Events are written only by the importers, which keep the original magnitude and unit next to the normalized value.
