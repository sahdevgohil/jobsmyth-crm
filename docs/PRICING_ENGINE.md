# Pricing engine

All money is integer cents. Source: the client customer price sheet (supplied in the task text; not in the repository).

## Catalog
- `PriceCatalog` per company; statuses `draft`, `approved`, `retired`. **Seeded as DRAFT / unapproved.** Approved catalogs are immutable: editing creates a new draft version.
- Packages: **Good** $450-495, **Better** $525-575, **Best** $650-725 per square. Shown as price *ranges*, never as a guaranteed total.
- 18 line items with the client rates, plus conditional charges: steep pitch 7-9/12 $35/SQ and 10-12/12 $60/SQ; two-story or higher $15/SQ; extra tear-off layer $45/SQ; OSB $85/sheet; plywood $95/sheet; re-deck $175/SQ; permit and city fees **at cost** (entered per job).
- Warranty years (5/10/25) are **placeholders**, flagged as such. Manufacturer eligibility is **unconfirmed**. Neither is presented as a promise.

## Quote (`POST /pricing/quote`)
Pure function (`quote-engine.ts`). Rules: field-shingle rates already include 10-15% waste, so no second waste factor is added; conditional charges apply only when triggered; optional items only when chosen; **tax is explicit** (`taxRateBps` null means not calculated, pending CPA); a discount reduces the selling price. Warnings list items that have no quantity.

## Estimate and snapshot
`POST /pricing/estimates` creates a normal estimate whose lines are the snapshot, with `pricingSource {catalogId, catalogVersion, catalogStatus, package, inputs, priceValidUntil}`. Later catalog edits never change issued estimates (tested).
**Proposals are blocked** with 409 `PRICING_NOT_APPROVED` for estimates priced from a catalog that is not approved, and with 409 `PRICE_EXPIRED` after the validity window (default 30 days).

## Profitability
The cost sheet per estimate lives in a separate collection (see `SUBCONTRACTOR_COSTS.md`). **Gross margin = (selling - cost) / selling**, in basis points, where selling = subtotal - discount. It is not markup.

## Permissions
`pricing:read` (sales and admin); `pricing:approve`, `costs:view`, `costs:manage`, `margins:view` (admin only by default). Catalog edits and approvals, rate overrides and cost changes are audited.

## UI
`/app/price-catalog` (view, approve, install), `/app/quote` (package picker, inputs, line table, totals, create estimate), and the cost panel on the estimate page.

## Open client decisions
Price approval, tax treatment, warranty terms, manufacturer eligibility, supplier validation of every line item, and pricing for services other than roofing (only roofing is priced).
