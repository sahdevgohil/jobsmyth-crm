# Inspection workflows

All templates below are installed by `POST /forms/templates/install-defaults` (UI: Form templates, then Install default forms) as published v1. Wording follows the client documents supplied in the task text. The client should review the field lists before relying on them.

| Template key | Purpose |
|---|---|
| `customer_intake` | Customer, property, service interest, lead source, assigned rep, consent |
| `roofing_job_details` | Roof history, job type, timeline; **insurance section only for insurance jobs** |
| `roofing_inspection` | Condition ratings, measurements, per-slope hail/damage counts, gutters, **required photo checklist** (four elevations, each slope, test squares, damage close-ups, every penetration, gutters, interior damage when there are leaks) and homeowner acknowledgement |
| `remodeling_inspection` | **Area-based** (kitchen, bathroom, basement, living space, addition, whole home, exterior): goals, budget, timeline, measurements (computed square footage), existing conditions |
| `gutter_inspection`, `siding_inspection`, `windows_doors_inspection`, `exterior_paint_inspection`, `fencing_inspection`, `decks_patios_inspection`, `solar_skylights_inspection` | Exterior-service inspections |

## Flow
Intake, then appointment, then inspection in **Field mode** (works offline), then complete, then branded PDF, then measurement/estimate.
- Completing validates required fields and photo minimums. The device pre-checks; the server is the authority.
- A completed submission is read-only. The PDF is stored as an internal `File` on the customer, property and inspection.
- The signature is an **acknowledgement only**. The PDF says the homeowner acknowledges the inspection findings; it does not claim a legally binding signature or authorize work.

## Customer intake and consent
Consent is asked per channel (text, email). Each stored consent keeps the answer, timestamp, source, the exact wording shown and its version. Unanswered is never treated as consent. The wording in use is a placeholder pair in `default-templates.ts` (`CONSENT_WORDING`, v1); **legal review is a client decision**.
Intake creates customer, property and lead in one transaction, is idempotent on `clientId`, and blocks same-company duplicates (phone, email, address) unless "Create anyway" is chosen. A salesperson can only assign leads to themselves.

## Data reuse
Intake answers populate the customer, property and lead. Inspections link to customer, property and appointment. The quote builder creates an estimate against the same customer and property. Pulling inspection measurements into an estimate automatically is **not built**; measurements are still entered on the measurement and quote screens.

## Not covered
- Map pins use the device GPS ("Drop pin at my location") plus a link to OpenStreetMap; there is no embedded interactive map.
- Project cost entries (estimated vs actual) are not built.
