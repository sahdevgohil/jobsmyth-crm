# Form builder

Admin-configurable forms for intake, job details and inspections. One engine (`shared/form-engine.ts`) validates on the device and on the server.

## Model
- **Template** (`FormTemplate`) is the editable working copy. **Publishing** freezes it as an immutable **version** (`FormTemplateVersion`). Submissions pin the version they were started with, so editing a template never changes an existing submission.
- Scoped to a company (`companyId`). See `TENANT_ARCHITECTURE_DECISION.md`.
- Field ids are stable machine ids. Answers are stored by id, so renaming a label never orphans data. Publishing flags breaking changes (removed field, changed type).

## 15 field types
text, long_text, number, currency (cents), date, datetime, dropdown, multiselect, yes_no, condition_rating (Good / Fair / Damaged / Needs replacement / N/A, with notes, optional measurement and photos), measurement (SQ, LF, SF, EA, in, ft, yr), photos, file, signature, address (with optional lat/lng).

## Rules
- **Conditions** (`eq, neq, in, includes, notEmpty, empty, all, any`) on fields and sections. Hidden fields are never required and their answers are discarded by the server.
- **Validation**: required, min/max, max length, regex pattern, enum membership, units. Two modes: `draft` (shape only, so a rep can save half a form) and `complete` (required fields, photos, notes).
- **Computed fields** (`product`, e.g. length x width) are recomputed on the server; client values are ignored.
- **Condition rating** can require photos/notes for chosen ratings (`photoRequiredFor`, `noteRequiredFor`).
- **Sensitive** fields (insurance, policy, claim, mortgage) are masked for users without `intake:sensitive`, excluded from lists and from PDF reports. The mask `[restricted]` can never overwrite real data.
- Activate/deactivate a template; deactivated forms cannot start new submissions.
- Intake templates must keep the core customer fields (server-enforced).

## API (`/api/v1/forms`)
Templates: `GET/POST /templates`, `POST /templates/install-defaults`, `GET/PATCH /templates/:id`, `POST /templates/:id/publish`, `GET /templates/:id/versions[/:n]`.
Submissions: `POST/GET /submissions`, `GET/PATCH /submissions/:id`, `POST /submissions/:id/complete`, `GET /submissions/:id/report`. Also `POST /sync` and `POST /intake`.
Permissions: `forms:read`, `forms:submit`, `forms:manage`, `intake:sensitive`, `inspections:complete`.

## UI
`/app/forms` (list, create, install defaults) and `/app/forms/:id` (sections and fields: add, edit, remove, reorder; options; required; help text; min/max; sensitive; show-when condition; save draft; publish with change note; version history; live preview). Compound `all/any` conditions from the default forms are preserved but only simple conditions are editable in the UI.

## Known limits
- Submission history is available through the API (`GET /submissions`) and the report; there is no dedicated history screen yet.
- Options added in the builder get a value derived from the label. To rename a published option, add a new option instead of editing the label.
