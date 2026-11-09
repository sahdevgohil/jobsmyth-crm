# Subcontractor costs and margins (INTERNAL)

Never shown to customers, proposals, the portal or PDF reports. Tested: "internal costs never appear in estimate, proposal or portal responses".

## Rate cards
`SubcontractorRateCard` per company, optionally tied to a subcontractor record. Seeded from the client "Sub-Contractor Price List" as a **DRAFT** (33 rates: shingle pitch rates per SQ, fortified roof, labor items). The client note is preserved: pricing *includes materials delivered on the ground and hand loading*; the same inclusions are **not assumed** for separately listed labor items. Ranges are kept as min/max (`rateCents` null). Approved cards are immutable (edit creates a new draft version).

## Cost sheet
`GET/PUT /pricing/estimates/:id/costs`. Lines are `subcontractor`, `material` or `other`. Subcontractor lines pick a rate from a card and the unit cost is copied (snapshot). Changing a copied rate requires an override reason and is audited. Totals by kind are computed on the server.

## Margin
Visible only with `margins:view`. Selling price = estimate subtotal - discount; gross profit = selling - total cost; **gross margin = profit / selling** (not markup). The screen states the formula.

## UI
`/app/rate-cards` (view; admin edits rates and approves) and the "Internal costs and margin" panel on each estimate. Users without `costs:view` do not get the panel.

## Not built
Per-project estimated vs actual cost entries, purchase orders, and automatic cost suggestions from measurements.
