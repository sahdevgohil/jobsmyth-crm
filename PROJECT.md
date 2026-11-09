# LEGACY ROOFING CRM
## Master Project Specification, Product Requirements & Implementation Plan

**Project:** Legacy Roofing CRM  
**Client:** Legacy Construction Group  
**Industry:** Roofing, construction, roof repair, roof replacement and storm restoration  
**Product type:** Internal business CRM and operations platform  
**Deployment model:** Single-company deployment  
**Document status:** Master product specification  
**Implementation strategy:** Preserve completed Phase 1 and Phase 2; implement all remaining approved modules sequentially.

---

# 1. PROJECT PURPOSE

## 1.1 Overview

Legacy Roofing CRM is a centralized business management platform for Legacy Construction Group, a roofing and construction company based in Texas.

The company currently relies on spreadsheets, manual processes and disconnected tools to manage customer information, leads, sales activities, roof inspections, estimates, proposals, projects, subcontractors, invoices and customer communication.

The purpose of this CRM is to bring these workflows into one system.

The platform should allow the company to manage the complete customer journey:

1. A lead enters the CRM.
2. A salesperson is assigned.
3. The salesperson contacts the prospect.
4. The prospect is converted into a customer.
5. The property is inspected.
6. Roof measurements and estimates are prepared.
7. A proposal is created and sent.
8. The customer approves the proposal and signs.
9. The project is created and scheduled.
10. Materials and subcontractors are coordinated.
11. Work is completed.
12. An invoice is generated.
13. Payment is recorded.
14. The customer receives updates and documents.
15. The project is closed and retained in the customer's history.

The CRM must provide a clear view of the entire process, from the first inquiry to final payment and after-sales follow-up.

## 1.2 Primary objectives

- Eliminate unnecessary spreadsheet-based workflows.
- Centralize leads, customers, properties and project information.
- Improve lead assignment and sales tracking.
- Manage appointments, inspections and site documentation.
- Create estimates and professional proposals.
- Manage projects, schedules, work orders and subcontractors.
- Track invoices, payments and outstanding balances.
- Provide customer communication and a customer portal.
- Provide meaningful operational and financial reporting.
- Maintain a complete history of important business activities.
- Make the system usable on desktop, tablet and mobile browsers.

## 1.3 Product principles

The system must be:

- Reliable: business records must not disappear or become inconsistent.
- Practical: workflows should reflect how a roofing company operates.
- Maintainable: use the existing architecture and modular code organization.
- Secure: protect customer, financial and company information.
- Responsive: support desktop and mobile web.
- Auditable: important business actions must be traceable.
- Honest about integrations: never present a simulated integration as a working external integration.
- Extensible: allow future capabilities without requiring a rewrite.

---

# 2. SCOPE AND PRODUCT BOUNDARIES

## 2.1 Included in the project

The approved product scope includes:

1. Authentication and access control.
2. User and company administration.
3. Dashboard and analytics.
4. Leads and sales pipeline.
5. Customers and properties.
6. Activities and notifications.
7. Appointments and scheduling.
8. Inspections and inspection documentation.
9. Photo and document management.
10. Roof measurement data management.
11. Estimates and pricing.
12. Proposals and electronic signatures.
13. Materials and material tracking.
14. Projects and project scheduling.
15. Subcontractor management.
16. Work orders and task management.
17. Invoices and payment tracking.
18. QuickBooks Online integration boundary.
19. Email and SMS communication.
20. Customer portal.
21. Project completion and after-sales workflows.
22. Global search.
23. Operational and financial reports.
24. Audit logs and system settings.

## 2.2 Explicitly excluded

Do not implement the following as part of the current scope unless the client explicitly approves a change:

- Native Android application.
- Native iOS application.
- Offline-first mobile application or offline synchronization.
- Multi-tenant SaaS architecture.
- SaaS subscription billing.
- Insurance claims processing.
- Xactimate integration.
- ESX file processing.
- Insurance supplements.
- RCV/ACV/depreciation calculations.
- Mortgage or insurance check workflows.
- Drone-based roof measurement.
- AI roof recognition.
- AI storm damage intelligence.
- Subcontractor login portal.
- Automatic external integrations that have not been validated.

Do not silently add these features because they appear useful.

## 2.3 Mobile experience

Responsive mobile web is included.

Users should be able to:

- View their dashboard.
- View and update leads.
- Access customer and property information.
- View appointments.
- Record inspection information.
- Upload photos and documents.
- View project information.
- Update permitted tasks and work statuses.
- View invoices and payment status.

Do not create a separate mobile application.

---

# 3. EXISTING TECHNOLOGY AND ARCHITECTURE

## 3.1 Existing stack

The existing repository uses:

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn-style component architecture
- React Router
- TanStack Query
- Zustand where appropriate
- React Hook Form
- Zod

### Backend

- Node.js
- Express
- TypeScript
- MongoDB
- Mongoose

### Testing and tooling

- Vitest
- Playwright
- ESLint
- TypeScript strict checks
- Build verification
- GitHub Actions CI

Use the versions and dependencies already present in the repository unless a justified compatibility issue requires a change.

## 3.2 Architecture

Use a modular monolith.

The frontend and backend remain separate applications within the existing repository.

The backend should organize functionality into clear modules. Each module should maintain appropriate separation between:

- Routes.
- Controllers.
- Services.
- Models.
- Validation schemas.
- Permissions.
- Tests.
- Integration adapters where required.

The frontend should organize functionality around product modules and reusable UI components.

## 3.3 Architecture restrictions

- Do not convert the system into microservices.
- Do not replace MongoDB with another database.
- Do not rewrite the completed authentication system.
- Do not replace the existing frontend framework.
- Do not introduce unnecessary infrastructure.
- Do not add Redis, BullMQ or separate workers without a concrete requirement.
- Do not duplicate existing utility functions.
- Do not introduce a second competing permission system.
- Do not create a new API convention when an existing one already works.
- Do not make broad refactors unrelated to the feature being implemented.

## 3.4 Repository inspection requirement

Before implementation:

1. Inspect the complete repository structure.
2. Read the existing project documentation.
3. Read the Phase 1 implementation and verification report.
4. Read the Phase 2 implementation and verification report.
5. Inspect the existing models, routes, middleware and services.
6. Inspect the existing frontend pages, routing and shared components.
7. Inspect the existing tests and CI configuration.
8. Identify completed functionality and existing technical limitations.
9. Build an implementation checklist based on this document.

The repository is the source of truth for the actual code.

This document is the source of truth for intended product scope.

If existing code and this document conflict, do not blindly overwrite existing functionality. Identify the conflict, preserve working behavior, and choose the smallest safe implementation that satisfies the approved requirements.

---

# 4. CURRENT IMPLEMENTATION STATUS

## 4.1 Phase 1 — Foundation

**Status: Implemented and locally verified.**

Existing functionality includes:

- Authentication.
- Login and logout.
- Refresh-token handling.
- Argon2id password hashing.
- HTTP-only refresh cookies.
- Permission-based access control.
- Authentication rate limiting.
- Temporary password onboarding.
- Password reset and invitation token APIs.
- User administration.
- Company settings.
- Lookup values.
- Audit logs.
- Initial seed configuration.
- Frontend authentication flows.
- Forced password change.
- Users, settings, lookups and audit screens.

Security hardening already completed includes:

- Atomic refresh-token rotation claim.
- Backend enforcement of forced password changes.
- Strict password reset and invitation rate limiting.
- Session revocation after invitation acceptance.
- Sensitive authentication and cookie header redaction.

Important limitations:

- Resend email delivery still requires configuration.
- User edit UI is incomplete even though an edit API exists.
- Staging deployment has not been confirmed.
- GitHub Actions must be checked on the actual default branch.

Do not rebuild Phase 1.

Only modify it when another feature requires a necessary, backward-compatible extension or a verified defect needs correction.

## 4.2 Phase 2 — Core CRM

**Status: Implemented and locally verified.**

Existing functionality includes:

- Customer management.
- Property management.
- Lead management.
- Salesperson assignment.
- Round-robin assignment.
- Pipeline stages.
- Lead conversion.
- Lead activities.
- Duplicate detection.
- Lead kanban.
- Website lead intake API.
- Notifications.
- Dashboard metrics.
- Customer and property archive workflows.
- Search and validation.
- Permission enforcement.

Important completed hardening includes:

- Atomic round-robin assignment.
- Concurrent-safe intake idempotency.
- Stage validation.
- Best-effort notification delivery after successful lead creation.
- Protection against deactivating stages used by open leads.
- Dedicated public intake rate limiting.
- Email validation.
- Search input escaping.
- Customer deletion permission alignment.
- Vitest and Playwright configuration separation.

Existing test results recorded in the Phase 2 report:

- Backend: 45 tests passed.
- Frontend: 6 tests passed.
- Lint, typecheck and build passed.
- Playwright E2E execution was skipped when the required environment was not configured.

Do not claim skipped E2E tests passed.

Important partial features:

- Pipeline stage administration UI is incomplete.
- Lead movement uses selection rather than drag-and-drop.
- Some dashboard tile deep-links are partial.
- Customer duplicate checks are not fully wired into the creation UI.
- Customer-related project functionality is deferred to later modules.

Do not rebuild Phase 2.

Complete only the necessary extensions as part of the later modules.

---

# 5. USERS, ROLES AND PERMISSIONS

## 5.1 User types

The application should support the following role concepts:

### Admin

Responsible for company-wide administration.

Can:

- Manage users.
- Manage roles and permissions.
- Manage company settings.
- View company-wide CRM data.
- Manage pipeline stages.
- View company-wide dashboards and reports.
- Manage financial configuration.
- Review audit logs.
- Configure integrations.

### Salesperson

Responsible for leads and sales activities.

Can, according to permissions:

- View assigned leads.
- Create and update leads.
- Contact prospects.
- Schedule appointments.
- Manage assigned opportunities.
- Convert leads into customers.
- View relevant customer and property information.
- Create or contribute to estimates and proposals.
- View assigned projects.

### Operations / Project Manager

Responsible for project execution.

Can, according to permissions:

- View relevant customers and properties.
- Schedule inspections.
- Manage projects.
- Manage tasks and work orders.
- Coordinate subcontractors.
- Track project progress.
- Manage materials.
- Upload project documentation.

### Finance / Accounting

Responsible for billing and payment tracking.

Can, according to permissions:

- View customer billing information.
- Create invoices.
- Record payments.
- Track outstanding balances.
- View financial reports.
- Manage permitted financial records.

### Additional roles

The permission system must allow future roles to be configured without hardcoding role-specific logic throughout the application.

Do not assume every role listed above is already approved as a separate company position.

## 5.2 Permission requirements

Use the existing permission-map architecture.

Every protected backend action must validate permission on the server.

Frontend visibility is not security.

Implement permissions for relevant actions such as:

- View.
- Create.
- Update.
- Assign.
- Archive.
- Delete.
- Approve.
- Send.
- Manage.
- Export.

Apply record-level restrictions where required.

The exact record visibility rules for salespeople require client confirmation. Preserve the existing documented behavior and do not silently broaden access.

## 5.3 User count and defaults

The currently documented company staffing assumption is:

- Five salespeople.
- One administrator.

This is a working assumption, not a confirmed final user count.

Do not hardcode user counts or limit the system to six accounts.

---

# 6. CORE BUSINESS DATA MODEL

Implement data models that support the complete customer-to-payment lifecycle.

The following is the intended conceptual data model. Reuse existing models where they already exist. Do not create duplicate collections for the same business concept.

## 6.1 User

Fields should include:

- Name.
- Email.
- Phone.
- Role or permission assignment.
- Active status.
- Authentication-related fields already supported by Phase 1.
- Created and updated timestamps.

## 6.2 Lead

Fields should include:

- Lead number or identifier.
- Customer/prospect name.
- Email.
- Phone.
- Lead source.
- Status.
- Pipeline stage.
- Assigned salesperson.
- Property reference where available.
- Project type or requested service.
- Notes.
- Follow-up date.
- Priority.
- Activities.
- Created by.
- Updated by.
- Timestamps.

Preserve existing lead fields and validation.

## 6.3 Customer

Fields should include:

- Customer identifier.
- Name.
- Email.
- Phone.
- Customer type where applicable.
- Contact details.
- Billing information.
- Properties.
- Notes.
- Status.
- Created and updated timestamps.

## 6.4 Property

Fields should include:

- Property identifier.
- Customer reference.
- Property address.
- City.
- State.
- ZIP code.
- Property type.
- Roof information where available.
- Access notes.
- Inspection history.
- Project history.
- Documents and photos.

Support multiple properties for a customer.

## 6.5 Appointment

Fields should include:

- Appointment identifier.
- Customer reference.
- Property reference.
- Related lead or project.
- Appointment type.
- Assigned employee.
- Start and end time.
- Time zone.
- Location.
- Status.
- Notes.
- Reminder status.
- Cancellation reason where applicable.

## 6.6 Inspection

Fields should include:

- Inspection identifier.
- Customer reference.
- Property reference.
- Related appointment.
- Assigned inspector.
- Inspection date.
- Inspection type.
- Findings.
- Damage observations.
- Roof condition.
- Measurements where available.
- Photos.
- Documents.
- Recommendations.
- Report status.
- Created and updated timestamps.

## 6.7 Estimate

Fields should include:

- Estimate identifier.
- Customer.
- Property.
- Related inspection.
- Line items.
- Quantities.
- Units.
- Unit prices.
- Labor costs.
- Material costs.
- Other charges.
- Taxes where applicable.
- Discounts.
- Subtotal.
- Total.
- Estimate status.
- Version.
- Notes.
- Created by.
- Approved by where applicable.

## 6.8 Proposal

Fields should include:

- Proposal identifier.
- Customer.
- Property.
- Estimate reference.
- Proposal number.
- Line items.
- Pricing.
- Terms and conditions.
- Payment schedule.
- Expiration date.
- Signature status.
- Signed document reference.
- Proposal status.
- Version.
- Created and updated timestamps.

## 6.9 Project

Fields should include:

- Project identifier.
- Project number.
- Customer.
- Property.
- Related lead.
- Related estimate.
- Related proposal.
- Project type.
- Project manager.
- Assigned employees.
- Status.
- Priority.
- Planned start date.
- Planned completion date.
- Actual completion date.
- Budget.
- Notes.
- Tasks.
- Work orders.
- Materials.
- Documents.
- Financial references.

## 6.10 Subcontractor

Fields should include:

- Subcontractor identifier.
- Company name.
- Contact person.
- Email.
- Phone.
- Address.
- Service categories.
- Internal notes.
- Active status.
- Relevant compliance or documentation fields where approved.

This is an internal management record, not a subcontractor portal.

## 6.11 Work order

Fields should include:

- Work order number.
- Project.
- Assigned subcontractor or internal employee.
- Work description.
- Location.
- Planned dates.
- Status.
- Instructions.
- Materials.
- Attachments.
- Completion notes.
- Approval status where applicable.

## 6.12 Material

Fields should include:

- Material name.
- SKU or product code where available.
- Description.
- Unit.
- Cost.
- Supplier.
- Availability or order status.
- Active status.

Avoid building a full warehouse or inventory management system unless approved.

## 6.13 Invoice

Fields should include:

- Invoice number.
- Customer.
- Property.
- Project.
- Invoice date.
- Due date.
- Line items.
- Subtotal.
- Tax.
- Discount.
- Total.
- Amount paid.
- Outstanding amount.
- Status.
- Payment records.
- External accounting reference where available.

## 6.14 Payment

Fields should include:

- Payment identifier.
- Invoice.
- Customer.
- Amount.
- Payment date.
- Payment method.
- Transaction reference.
- Status.
- Notes.
- Recorded by.
- External accounting reference where available.

## 6.15 Communication

Fields should include:

- Customer.
- Lead or project reference.
- Channel.
- Direction.
- Subject.
- Message content or safe provider reference.
- Delivery status.
- Provider message ID.
- Sender.
- Recipient.
- Timestamp.

Protect sensitive communication information and avoid storing unnecessary provider secrets.

## 6.16 Documents and photos

Use a reusable document metadata model.

Fields should include:

- File identifier.
- Original filename.
- Storage key.
- MIME type.
- File size.
- Category.
- Related customer.
- Related property.
- Related inspection.
- Related project.
- Uploaded by.
- Upload timestamp.
- Visibility.
- Metadata.

The actual file should be stored in configured object storage, not as an unrestricted binary inside a normal MongoDB document.

---

# 7. BUSINESS WORKFLOW AND STATUS RULES

## 7.1 Lead lifecycle

The lead workflow should support:

- New.
- Contacted.
- Follow-up required.
- Appointment scheduled.
- Inspection scheduled.
- Estimate preparation.
- Proposal preparation.
- Proposal sent.
- Won.
- Lost.

The existing configurable pipeline stage system remains authoritative.

Do not replace existing stage configuration with hardcoded frontend arrays.

Stage changes must be validated by the backend.

## 7.2 Customer conversion

When a lead is converted:

- Preserve the original lead.
- Create or link the customer.
- Link the relevant property.
- Preserve lead activities and history.
- Prevent accidental duplicate customers.
- Maintain an audit trail.
- Ensure the conversion operation is safe against duplicate submissions.

Do not lose the original lead source or salesperson attribution.

## 7.3 Project lifecycle

Support a configurable project lifecycle covering:

- Awaiting approval.
- Approved.
- Planning.
- Scheduled.
- Materials preparation.
- In progress.
- On hold.
- Quality review.
- Completed.
- Closed.
- Cancelled.

These are proposed working statuses. Reuse existing configuration patterns and make appropriate statuses configurable.

Do not allow invalid status transitions.

## 7.4 Financial lifecycle

Invoices should support:

- Draft.
- Sent.
- Partially paid.
- Paid.
- Overdue.
- Void.

Payments should have their own statuses and must not be treated as successful merely because a user clicked a button.

Record payment transactions and their references accurately.

## 7.5 Payment schedule

A 50% advance payment has been discussed as a possible default.

It is not a confirmed universal business rule.

Implement configurable payment schedules per company or proposal.

Never hardcode 50% as mandatory for every project.

---

# 8. PHASE 3 — APPOINTMENTS, INSPECTIONS AND DOCUMENTATION

## 8.1 Appointment management

Build a complete appointment management module.

Features:

- Create appointments.
- Edit appointments.
- Cancel appointments.
- Reschedule appointments.
- Assign employees.
- Link appointments to leads, customers, properties or projects.
- Set appointment type.
- Set date, start time and end time.
- Add notes and instructions.
- Track appointment status.
- Display appointments in calendar and list views.
- Filter by employee, status, date and appointment type.
- Show upcoming appointments on the dashboard.
- Provide mobile-friendly appointment views.

Prevent invalid time ranges.

Detect scheduling conflicts where appropriate.

Do not silently change an appointment's time zone.

Use a consistent storage convention for dates and times and display them in the configured local time zone.

## 8.2 Appointment reminders

Create a reminder architecture that supports:

- Email reminders.
- SMS reminders.
- Internal notifications.

Actual delivery depends on configured providers.

Do not show a reminder as delivered if the provider has not confirmed delivery.

## 8.3 Inspection management

Features:

- Create inspection from a lead, appointment, customer or property.
- Assign inspector.
- Record inspection date.
- Record roof condition.
- Record observed damage.
- Record findings.
- Add recommendations.
- Add notes.
- Record measurements.
- Upload multiple photos.
- Upload related documents.
- Track inspection status.
- Generate inspection reports.

## 8.4 Inspection reports

Create professional, printable inspection reports.

Reports should include:

- Company information.
- Customer information.
- Property address.
- Inspection date.
- Inspector information.
- Roof condition.
- Inspection findings.
- Observations.
- Recommendations.
- Photos with captions.
- Relevant measurements.
- Report generation date.

Reports must be readable, professional and suitable for sharing with customers.

## 8.5 Photo and file management

Support:

- Multiple file uploads.
- Image previews.
- File downloads.
- File categorization.
- File association with customer, property, inspection and project.
- Upload metadata.
- Access control.
- File size validation.
- MIME-type validation.
- Secure storage.

Use the existing document architecture if one exists.

Do not store publicly accessible unrestricted files.

---

# 9. PHASE 4 — ROOF MEASUREMENTS AND ESTIMATES

## 9.1 Measurement management

The system must support roof measurement information.

Potential data includes:

- Total roof area.
- Roof facets.
- Pitch.
- Ridge.
- Hip.
- Valley.
- Eave.
- Rake.
- Other relevant measurement values.
- Measurement units.
- Measurement source.
- Measurement date.
- Related property.
- Related inspection.
- Imported document or source file.

## 9.2 Integration constraints

Roofr API access has not been confirmed.

Do not assume Roofr provides accessible API credentials or supported endpoints.

The system must support manual measurement entry and manual document/data import.

Possible future providers include:

- Roofr.
- EagleView.
- HOVER.

These are not confirmed active integrations.

Create provider adapters only where the provider's actual API, authentication, documentation and access have been verified.

If credentials are unavailable:

- Build the internal measurement workflow.
- Build manual import functionality.
- Show the integration as not configured.
- Do not generate fake successful synchronization results.

## 9.3 Estimate builder

Build a complete estimate builder.

Features:

- Create estimate from customer/property.
- Link inspection.
- Add and remove line items.
- Edit descriptions.
- Set quantities.
- Set units.
- Set material costs.
- Set labor costs.
- Add other costs.
- Apply discounts.
- Apply configured taxes.
- Calculate totals.
- Save drafts.
- Duplicate estimates.
- Version estimates.
- Preview estimates.
- Export or print estimates.
- Track estimate status.

Calculations must happen safely and consistently.

Do not trust frontend totals for financial records.

The backend must validate and calculate authoritative totals.

## 9.4 Pricing configuration

Allow authorized administrators to configure:

- Material pricing.
- Labor pricing.
- Standard line items.
- Units.
- Tax settings.
- Discounts.
- Default pricing values.

Do not invent company-specific tax rates, pricing or profit margins.

---

# 10. PHASE 5 — PROPOSALS, SIGNATURES AND MATERIALS

## 10.1 Proposal management

Create professional proposals from estimates.

Features:

- Proposal creation.
- Proposal editing.
- Proposal versioning.
- Proposal preview.
- PDF generation.
- Customer information.
- Property information.
- Scope of work.
- Line items.
- Pricing breakdown.
- Terms and conditions.
- Payment schedule.
- Expiration date.
- Proposal status.
- Send proposal.
- Track customer response.
- Track approval or rejection.

A proposal must preserve the version sent to the customer.

Changes to a draft must not silently modify an already signed proposal.

## 10.2 Electronic signatures

Support an integration boundary for an electronic signature provider.

Potential providers:

- Dropbox Sign.
- DocuSign.

Provider access and credentials must be validated before implementation of live sending.

The internal signature workflow should support:

- Signature request creation.
- Recipient information.
- Request status.
- Signed timestamp.
- Signed document reference.
- Provider reference.
- Error status.
- Audit trail.

Do not fake legally binding signatures.

If provider credentials are missing, the interface must clearly show that electronic signing is not configured.

## 10.3 Materials management

Support materials associated with estimates, proposals and projects.

Features:

- Material catalogue.
- Material descriptions.
- Units.
- Costs.
- Suppliers.
- Project material requirements.
- Material order status.
- Material delivery status.
- Notes and attachments.

Do not expand this into full warehouse management or complex inventory accounting.

---

# 11. PHASE 6 — PROJECTS, SUBCONTRACTORS AND WORK ORDERS

## 11.1 Project management

A project should normally be created after proposal approval or another authorized business decision.

Features:

- Create project.
- Link customer.
- Link property.
- Link lead.
- Link proposal.
- Link estimate.
- Assign project manager.
- Assign internal employees.
- Set start date.
- Set expected completion date.
- Set project status.
- Set priority.
- Add internal notes.
- Upload documents.
- View project timeline.
- Track progress.
- Track project tasks.
- View financial summary.
- View communication history.

## 11.2 Project task management

Features:

- Create task.
- Assign task.
- Set due date.
- Set priority.
- Set status.
- Add notes.
- Attach files.
- Track completion.
- View tasks by project.
- Filter tasks by employee and status.

## 11.3 Project scheduling

Provide calendar and timeline-style project views.

Support:

- Planned start and end dates.
- Actual start and end dates.
- Schedule changes.
- Delays.
- On-hold status.
- Internal notes.

Avoid building a complex enterprise resource planning scheduler.

## 11.4 Subcontractor management

Features:

- Create subcontractor.
- Edit subcontractor.
- Archive subcontractor.
- Store company and contact details.
- Categorize services.
- Add internal notes.
- Associate subcontractor with projects.
- Associate subcontractor with work orders.
- Track assigned work.
- Track work completion.

Do not create a subcontractor login portal.

## 11.5 Work orders

Features:

- Create work order.
- Link project.
- Assign subcontractor or internal employee.
- Define work scope.
- Add instructions.
- Add materials.
- Set schedule.
- Track status.
- Upload documents.
- Record completion notes.
- Record issues.
- Maintain work order history.

---

# 12. PHASE 7 — INVOICES, PAYMENTS AND ACCOUNTING

## 12.1 Invoice management

Features:

- Create invoice.
- Generate invoice from project or approved estimate.
- Add line items.
- Calculate subtotal.
- Calculate tax.
- Calculate total.
- Set invoice date.
- Set due date.
- Generate invoice number.
- Preview invoice.
- Generate PDF.
- Send invoice.
- Track invoice status.
- Track amount paid.
- Track outstanding balance.
- View invoice history.

Prevent duplicate invoice generation from repeated requests.

## 12.2 Payment tracking

Features:

- Record payment.
- Link payment to invoice.
- Record payment amount.
- Record payment date.
- Record payment method.
- Record transaction reference.
- Support partial payments.
- Calculate outstanding balance.
- Track payment status.
- Display payment history.
- Support refunds or adjustments only if approved and properly represented in the data model.

Do not treat an offline manual payment record as an externally verified transaction.

Clearly distinguish:

- Manually recorded payments.
- Provider-confirmed payments.
- Imported accounting records.

## 12.3 QuickBooks Online integration

QuickBooks Online integration is required as an integration boundary, but live access and credentials must be validated.

Potential functionality:

- OAuth connection.
- Connection status.
- Customer mapping.
- Invoice synchronization.
- Payment synchronization.
- External reference storage.
- Sync history.
- Error handling.
- Retry handling.
- Duplicate prevention.

Do not create fake QuickBooks synchronization.

If credentials are unavailable:

- Implement provider interface and configuration status.
- Implement internal invoice and payment management.
- Document the remaining integration work.
- Do not claim live synchronization.

## 12.4 Financial reporting

Support:

- Total invoiced.
- Total collected.
- Outstanding balance.
- Overdue invoices.
- Revenue by date range.
- Revenue by project.
- Payment history.
- Invoice status distribution.

Financial reports must use accurate backend aggregation.

---

# 13. PHASE 8 — COMMUNICATION, CUSTOMER PORTAL AND ANALYTICS

## 13.1 Communication center

Provide a centralized communication history.

Features:

- Customer communication timeline.
- Email history.
- SMS history.
- Internal notes.
- Project-related communication.
- Lead-related communication.
- Delivery status.
- Provider references.

Users should be able to understand what was communicated, when and by whom.

## 13.2 Email integration

Resend has been identified as a possible email provider.

Live configuration is pending.

Support:

- Email sending.
- Templates.
- Customer notifications.
- Appointment reminders.
- Proposal delivery.
- Invoice delivery.
- Project updates.
- Delivery status.
- Error handling.

Never show an email as successfully delivered without provider confirmation.

## 13.3 SMS integration

Twilio has been identified as a possible SMS provider.

Live configuration is pending.

Support:

- SMS sending.
- Message templates.
- Appointment reminders.
- Project notifications.
- Customer updates.
- Delivery status.
- Provider message references.

Do not claim that SMS was sent if no provider is configured.

## 13.4 Customer portal

Build a secure customer-facing web portal.

Customers should be able to:

- Access their own account.
- View their properties.
- View relevant proposals.
- View proposal status.
- Review project information.
- View project updates.
- View relevant documents.
- View invoices.
- View payment history.
- View relevant inspection reports.
- Access permitted communication history.

Security requirements:

- Customers must only access their own authorized records.
- Never trust customer or project IDs supplied by the browser.
- Validate ownership and authorization on every request.
- Use secure customer authentication.
- Avoid exposing internal notes.
- Separate internal and customer-visible documents.
- Provide a secure password recovery flow.
- Audit sensitive customer portal actions.

The customer portal is included.

A subcontractor portal is not included.

## 13.5 After-sales management

Support:

- Project completion confirmation.
- Customer feedback.
- Warranty-related records where approved.
- Follow-up reminders.
- Service history.
- Customer notes.
- Future follow-up activities.

Do not invent warranty terms.

Store the actual terms supplied by the company.

## 13.6 Analytics and reporting

Provide dashboards and reports for:

### Sales

- Total leads.
- Leads by source.
- Leads by stage.
- Leads by salesperson.
- Conversion rate.
- Won and lost opportunities.
- Follow-up performance.

### Operations

- Upcoming appointments.
- Completed inspections.
- Projects by status.
- Delayed projects.
- Tasks by status.
- Work orders by status.
- Subcontractor workload.

### Finance

- Invoiced amount.
- Collected amount.
- Outstanding amount.
- Overdue invoices.
- Revenue over time.

### Customer activity

- New customers.
- Repeat customers.
- Properties managed.
- Recent activities.

Filters should include appropriate date ranges and employee/project filters.

Use backend aggregation rather than downloading all records into the browser.

---

# 14. GLOBAL SEARCH AND NAVIGATION

Implement a global search experience.

Search should cover relevant entities:

- Leads.
- Customers.
- Properties.
- Appointments.
- Inspections.
- Estimates.
- Proposals.
- Projects.
- Subcontractors.
- Invoices.

Search results must respect the current user's permissions.

Provide useful navigation between related records.

For example:

Customer → Property → Inspection → Estimate → Proposal → Project → Invoice.

Avoid creating isolated pages that do not connect to the rest of the CRM.

---

# 15. FILE STORAGE AND DOCUMENT GENERATION

## 15.1 Storage

S3-compatible object storage or Cloudflare R2 may be used after the company's preferred provider is confirmed.

Until configured:

- Implement a storage adapter.
- Keep local development storage available where appropriate.
- Document the production configuration requirement.
- Do not store production files in temporary local folders.

## 15.2 Security

Implement:

- File size limits.
- MIME-type validation.
- Safe filenames.
- Authorization checks.
- Secure upload handling.
- Secure downloads.
- Private storage.
- Expiring signed URLs where supported.
- Appropriate access logging.

## 15.3 Document generation

Support professional documents for:

- Inspection reports.
- Estimates.
- Proposals.
- Invoices.
- Work orders where useful.

Use reusable document templates.

Generated documents should include company branding and the relevant business record details.

---

# 16. NOTIFICATIONS AND AUDIT LOGGING

## 16.1 Internal notifications

Support notifications for:

- New lead assignment.
- Lead reassignment.
- Upcoming appointments.
- Appointment changes.
- Inspection completion.
- Proposal approval.
- Project status changes.
- Task assignments.
- Work order updates.
- Invoice creation.
- Payment recording.
- Overdue invoices.

Notifications should not block successful core business transactions unless the notification itself is a required part of the operation.

Preserve the Phase 2 best-effort notification behavior where appropriate.

## 16.2 Audit logging

Audit important actions such as:

- User creation and deactivation.
- Permission changes.
- Lead assignment.
- Lead conversion.
- Customer updates.
- Property updates.
- Inspection changes.
- Estimate changes.
- Proposal approval.
- Signature events.
- Project status changes.
- Work order updates.
- Invoice changes.
- Payment recording.
- Document access where required.

Audit records should include:

- Actor.
- Action.
- Entity type.
- Entity identifier.
- Timestamp.
- Relevant before/after information where safe.
- Request context where appropriate.

Never store passwords, access tokens, refresh tokens or provider secrets in audit logs.

---

# 17. INTEGRATION ARCHITECTURE

External integrations must be isolated behind provider adapters.

Do not place vendor-specific logic throughout controllers and frontend components.

Each integration should have:

- A provider interface.
- Configuration validation.
- Connection status.
- Credential handling.
- Error handling.
- Timeout handling.
- Logging.
- Retry strategy where safe.
- Idempotency where necessary.
- Tests using mocked provider responses.
- Clear documentation.

## 17.1 Integration status

| Integration | Current status | Required behavior |
|---|---|---|
| Roofr | API access not confirmed | Manual measurement/import fallback |
| EagleView | Not validated | Future provider adapter only |
| HOVER | Not validated | Future provider adapter only |
| Dropbox Sign | Credentials/access pending | Provider boundary and internal status |
| DocuSign | Credentials/access pending | Provider boundary and internal status |
| QuickBooks Online | Credentials/access pending | Internal financial workflows plus adapter |
| Resend | Configuration pending | Email adapter |
| Twilio | Configuration pending | SMS adapter |
| S3/R2 | Provider decision pending | Storage adapter |
| Sentry | Not configured | Configuration and setup documentation |
| Website lead form | Live integration pending | Existing public intake endpoint must be preserved |

Do not claim an integration is complete merely because an interface, adapter or configuration screen exists.

Use explicit statuses such as:

- Not configured.
- Configuration required.
- Connected.
- Syncing.
- Error.
- Disconnected.

Only use Connected when a real provider connection has been verified.

---

# 18. SECURITY AND DATA INTEGRITY

Security is a core requirement, not a later polish task.

Implement and preserve:

- Authentication.
- Server-side permission checks.
- Record-level authorization.
- Input validation.
- Output sanitization where appropriate.
- Secure cookies.
- Rate limiting.
- Secure file handling.
- Safe error responses.
- Audit logging.
- Secret management through environment variables.
- Protection against unauthorized record access.
- Protection against duplicate submissions.
- Atomic updates for concurrency-sensitive operations.

## 18.1 Financial integrity

Financial calculations must be authoritative on the backend.

Use appropriate numeric handling for currency. Avoid floating-point calculation errors.

Prevent:

- Duplicate invoices.
- Duplicate payment records caused by retries.
- Negative or invalid amounts unless a specifically approved adjustment workflow supports them.
- Incorrect outstanding balances.
- Unauthorized payment edits.
- Accidental modification of finalized documents.

## 18.2 Data relationships

Validate that linked records belong together.

Examples:

- A proposal must belong to the correct customer and property.
- An invoice must reference the correct project/customer.
- A work order must reference a valid project.
- A payment must reference a valid invoice.
- A document must not become accessible merely because its identifier is known.

## 18.3 Deletion

Prefer archive or soft-delete workflows for important business records.

Hard deletion should be restricted and should not break historical references.

Do not cascade-delete financial, customer or project history without an explicitly approved rule.

---

# 19. FRONTEND EXPERIENCE AND DESIGN REQUIREMENTS

The product should look and behave like a professional business CRM.

## 19.1 General design principles

- Clean and professional.
- Consistent layout.
- Clear information hierarchy.
- Practical data tables.
- Useful filters.
- Responsive forms.
- Readable typography.
- Consistent spacing.
- Clear status indicators.
- Useful empty states.
- Useful loading states.
- Useful error states.
- Accessible controls.

Do not introduce unnecessary animations or decorative elements.

Do not redesign the completed application without a concrete reason.

## 19.2 Main navigation

The application should provide clear navigation for:

- Dashboard.
- Leads.
- Customers.
- Properties.
- Calendar/Appointments.
- Inspections.
- Estimates.
- Proposals.
- Projects.
- Subcontractors.
- Work Orders.
- Materials.
- Invoices.
- Payments.
- Communications.
- Reports.
- Settings.
- Users and permissions.

Only display modules the current user is permitted to access.

## 19.3 UI behavior

Every major page should support:

- Loading state.
- Empty state.
- Error state.
- Success feedback.
- Form validation.
- Search and filtering where relevant.
- Pagination or suitable scalable loading.
- Permission-aware actions.
- Responsive layouts.

Avoid inert buttons and fake functionality.

Every visible action must either work or clearly explain why it is unavailable.

---

# 20. API AND BACKEND REQUIREMENTS

## 20.1 API conventions

Follow the existing API versioning and response conventions.

Use the existing `/api/v1` convention.

Every endpoint must have:

- Authentication where required.
- Permission checks.
- Input validation.
- Consistent error handling.
- Correct HTTP status codes.
- Appropriate logging.
- Tests.

Public endpoints must have appropriate rate limiting and abuse protection.

## 20.2 Backend business logic

Keep business rules in services rather than embedding them directly in route handlers.

Use database transactions or atomic operations where necessary and supported by the existing MongoDB architecture.

Consider concurrency for:

- Lead assignment.
- Duplicate intake.
- Customer conversion.
- Invoice generation.
- Payment recording.
- Proposal approval.
- Project status transitions.

## 20.3 API documentation

Document new endpoints and important behavior.

Update the relevant module documentation when API contracts change.

Do not leave documentation describing behavior that the implementation does not provide.

---

# 21. TESTING AND QUALITY REQUIREMENTS

Testing must be performed throughout implementation, not only at the end.

## 21.1 Backend tests

Test:

- Service logic.
- Validation.
- Permissions.
- Record-level access.
- Status transitions.
- Calculations.
- Duplicate handling.
- Concurrency-sensitive operations.
- Integration adapters.
- Error handling.

## 21.2 Frontend tests

Test:

- Important components.
- Forms.
- Validation.
- Loading and error states.
- Permission-based rendering.
- Main user workflows.

## 21.3 End-to-end tests

Create practical Playwright tests for the main business journey:

1. Admin logs in.
2. Admin creates or manages a user.
3. A lead is created.
4. A lead is assigned.
5. A salesperson updates the lead.
6. An appointment is scheduled.
7. An inspection is recorded.
8. Photos are uploaded.
9. An estimate is created.
10. A proposal is generated.
11. A proposal is approved through the configured workflow.
12. A project is created.
13. A task or work order is assigned.
14. Project progress is updated.
15. An invoice is generated.
16. A payment is recorded.
17. Customer portal access is checked.
18. Relevant reports are reviewed.

Use test data and isolated environments.

Do not require live third-party credentials for normal automated tests.

Mock external providers where appropriate.

## 21.4 Required verification

At completion:

- Backend tests pass.
- Frontend tests pass.
- Lint passes.
- TypeScript checks pass.
- Frontend build passes.
- Backend build passes.
- Relevant Playwright workflows pass in a configured test environment.
- Existing Phase 1 and Phase 2 tests continue to pass.

Never report a test as passed if it was skipped, not executed or blocked by missing configuration.

---

# 22. DOCUMENTATION REQUIREMENTS

Maintain the following documentation in the repository.

## 22.1 PROJECT.md

This master specification.

Update only when an approved scope or business decision changes.

## 22.2 ARCHITECTURE.md

Document:

- Application architecture.
- Module boundaries.
- Frontend structure.
- Backend structure.
- Database approach.
- Authentication.
- Permissions.
- Integration architecture.
- File storage.
- Deployment architecture.

## 22.3 DATABASE.md

Document:

- Collections.
- Models.
- Relationships.
- Important indexes.
- Validation.
- Deletion/archive behavior.
- Data integrity rules.

## 22.4 API.md

Document important API endpoints, permissions and request/response behavior.

## 22.5 INTEGRATIONS.md

Document:

- Providers.
- Configuration.
- Environment variables.
- Connection status.
- Supported capabilities.
- Known limitations.
- Pending credentials and external dependencies.

## 22.6 IMPLEMENTATION_STATUS.md

Maintain a live checklist of all modules and requirements.

Each feature must have one of these statuses:

- Not started.
- In progress.
- Implemented.
- Tested.
- Blocked.
- Deferred.

Do not mark a feature Tested unless its relevant tests actually ran successfully.

## 22.7 TESTING.md

Document:

- How to run backend tests.
- How to run frontend tests.
- How to run E2E tests.
- Required environment variables.
- Test data setup.
- Known test limitations.

## 22.8 DEPLOYMENT.md

Document:

- Required runtime.
- Environment variables.
- Database setup.
- Storage setup.
- Email setup.
- SMS setup.
- Integration credentials.
- Build process.
- Deployment steps.
- Backup and recovery expectations.

---

# 23. OPEN BUSINESS DECISIONS AND EXTERNAL BLOCKERS

Do not invent answers to the following unresolved items.

Maintain them in implementation documentation and identify where they affect the product.

| ID | Decision / dependency | Current status |
|---|---|---|
| Q-001 | Final user count and staffing confirmation | Working assumption: five salespeople and one admin |
| Q-002 | Lead assignment rules | Client confirmation pending |
| Q-003 | Record visibility rules | Client confirmation pending |
| Q-005 | Final pipeline stage definitions | Client confirmation pending |
| Q-006 / INT-09 | Live company website lead form integration | Pending |
| Q-021 | CSV migration approval | Not approved; do not implement migration without approval |
| Q-027 / D-029 | Hosting and staging decision | Pending |
| INT-10 | Sentry configuration | Pending |
| Roofr | API access and credentials | Not confirmed |
| Signature provider | Dropbox Sign or DocuSign selection and credentials | Pending |
| QuickBooks | Account access and integration credentials | Pending |
| Resend | Email configuration | Pending |
| Twilio | SMS configuration | Pending |
| S3/R2 | Storage provider decision and credentials | Pending |

For each blocker:

1. Implement what can safely be implemented independently.
2. Record the dependency.
3. Avoid fake external behavior.
4. Make configuration requirements clear.
5. Document what remains before production activation.

Do not stop the entire CRM implementation because one external credential is missing.

---

# 24. IMPLEMENTATION ORDER

Implement the remaining system in dependency order.

Phase 1 and Phase 2 are already implemented. Do not restart them.

## Stage A — Stabilize the existing foundation

- Inspect current code.
- Confirm current tests.
- Confirm permission conventions.
- Confirm API conventions.
- Confirm model conventions.
- Identify shared utilities.
- Identify existing UI patterns.
- Confirm current documentation.
- Create a baseline implementation status.

Do not perform a large rewrite.

## Stage B — Phase 3

Implement:

- Appointments.
- Scheduling.
- Calendar views.
- Inspection management.
- Inspection reports.
- Photo uploads.
- Document management.

## Stage C — Phase 4

Implement:

- Measurement records.
- Manual measurement entry.
- Measurement import.
- Estimate builder.
- Pricing configuration.
- Estimate PDF and preview.

## Stage D — Phase 5

Implement:

- Proposal management.
- Proposal versioning.
- Proposal PDF.
- Signature provider boundary.
- Signature status handling.
- Materials catalogue.
- Material requirements.

## Stage E — Phase 6

Implement:

- Project management.
- Project lifecycle.
- Project tasks.
- Project scheduling.
- Subcontractor management.
- Work orders.
- Project documentation.

## Stage F — Phase 7

Implement:

- Invoice management.
- Invoice generation.
- Payment tracking.
- Partial payment handling.
- Financial calculations.
- QuickBooks integration boundary.
- Financial reporting.

## Stage G — Phase 8

Implement:

- Communication center.
- Email integration boundary.
- SMS integration boundary.
- Customer portal.
- After-sales workflows.
- Global search.
- Operational analytics.
- Financial analytics.

## Stage H — System-wide completion

- Permission review.
- Security review.
- Data integrity review.
- Responsive review.
- Workflow testing.
- API documentation.
- Integration documentation.
- Deployment documentation.
- Final implementation report.

---

# 25. DEFINITION OF DONE

A feature is not complete merely because a page exists.

Every feature must satisfy the relevant requirements below.

## Functional completion

- Backend functionality exists.
- Frontend functionality exists where required.
- Data is persisted correctly.
- Validation works.
- Permissions work.
- Errors are handled.
- Related records remain consistent.
- User workflow is complete.
- No important action is a placeholder.

## Testing completion

- Relevant unit or integration tests exist.
- Relevant tests pass.
- Important workflows are tested.
- Existing tests are not broken.
- No skipped test is reported as passed.

## Documentation completion

- Implementation status is updated.
- API documentation is updated.
- Data model documentation is updated.
- Integration limitations are recorded.
- Setup instructions are updated.

## Integration completion

An integration is complete only when:

- Provider configuration is available.
- Authentication works.
- Real provider requests are supported.
- Provider responses are handled.
- Errors are handled.
- Relevant tests pass.
- Actual connection status is verified.

An adapter alone is not a completed live integration.

---

# 26. IMPORTANT IMPLEMENTATION RULES FOR CURSOR

These rules apply to every implementation task.

1. Read this entire document before implementing features.
2. Inspect the repository before changing files.
3. Preserve completed Phase 1 and Phase 2 functionality.
4. Do not rewrite existing modules for convenience.
5. Reuse existing components, services, utilities and patterns.
6. Follow the existing TypeScript strictness.
7. Use proper types; do not spread `any` through the codebase.
8. Validate all user input on the backend.
9. Enforce permissions on the backend.
10. Do not rely on frontend-only restrictions.
11. Do not create fake API responses.
12. Do not simulate successful third-party integrations.
13. Do not hardcode company-specific business decisions that are still pending approval.
14. Do not add excluded features.
15. Do not introduce unnecessary dependencies.
16. Do not add unnecessary architectural complexity.
17. Do not leave dead buttons or misleading UI.
18. Do not silently swallow errors.
19. Do not expose internal errors or secrets to users.
20. Do not remove existing tests to make the test suite pass.
21. Do not weaken existing security controls.
22. Do not change existing API contracts without checking consumers.
23. Do not make destructive database changes without a migration or compatibility plan.
24. Keep the application runnable throughout implementation.
25. Update documentation alongside implementation.
26. Keep the implementation status accurate.
27. Prefer complete end-to-end workflows over disconnected collections of screens.
28. Do not stop after producing a plan. Implement the features.
29. Do not mark a feature complete until its actual acceptance criteria are met.
30. If blocked by an external dependency, finish the internal workflow and record the remaining integration work.

---

# 27. FINAL PRODUCT EXPECTATION

The final result must be a usable roofing business management CRM, not just a collection of CRUD pages.

The major business workflow must work end to end:

**Lead → Customer → Property → Appointment → Inspection → Measurement → Estimate → Proposal → Approval → Project → Tasks / Work Orders → Materials → Invoice → Payment → Customer Portal → Reporting**

Related information must remain connected.

Users must be able to navigate from one stage to the next without manually re-entering the same information.

The application must preserve history and provide a reliable view of the current state of each customer, property and project.

External integrations must be clearly distinguished from internal functionality.

The CRM must be suitable for realistic internal company usage once its production environment, credentials and outstanding business decisions are configured.

---

# 28. FINAL IMPLEMENTATION REPORT

When the complete implementation is finished, produce a detailed report containing:

1. Summary of completed modules.
2. Features implemented.
3. Database models and relationships added or changed.
4. API endpoints added or changed.
5. Frontend pages and components added.
6. Permissions added or changed.
7. Integrations implemented.
8. Integrations awaiting credentials or provider validation.
9. Environment variables required.
10. Tests executed and their actual results.
11. Build, lint and typecheck results.
12. Known bugs and limitations.
13. Outstanding client decisions.
14. Production deployment requirements.
15. Exact remaining tasks, if any.

Do not claim the CRM is production-ready if required security, deployment, integration or business configuration remains incomplete.

**Final objective: deliver the complete approved Legacy Roofing CRM scope while preserving the existing working foundation, maintaining code quality and avoiding unnecessary rewrites.**