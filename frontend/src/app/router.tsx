import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { PortalLayout } from '@/layouts/PortalLayout';
import { AcceptInvitePage } from '@/pages/AcceptInvitePage';
import { AfterSalesPage } from '@/pages/AfterSalesPage';
import { AppointmentCalendarPage } from '@/pages/AppointmentCalendarPage';
import { AppointmentDetailPage } from '@/pages/AppointmentDetailPage';
import { AppointmentNewPage } from '@/pages/AppointmentNewPage';
import { AppointmentsPage } from '@/pages/AppointmentsPage';
import { AuditPage } from '@/pages/AuditPage';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { CommunicationsPage } from '@/pages/CommunicationsPage';
import { CustomerDetailPage } from '@/pages/CustomerDetailPage';
import { CustomerNewPage } from '@/pages/CustomerNewPage';
import { CustomersPage } from '@/pages/CustomersPage';
import { EstimateDetailPage } from '@/pages/EstimateDetailPage';
import { EstimateNewPage } from '@/pages/EstimateNewPage';
import { EstimatesPage } from '@/pages/EstimatesPage';
import { FieldFormPage } from '@/pages/FieldFormPage';
import { FieldHomePage } from '@/pages/FieldHomePage';
import { FormBuilderPage } from '@/pages/FormBuilderPage';
import { FormTemplatesPage } from '@/pages/FormTemplatesPage';
import { IntakePage } from '@/pages/IntakePage';
import { SolarNewPage } from '@/pages/SolarNewPage';
import { SolarUsagePage } from '@/pages/SolarUsagePage';
import { PriceCatalogPage } from '@/pages/PriceCatalogPage';
import { QuoteBuilderPage } from '@/pages/QuoteBuilderPage';
import { RateCardsPage } from '@/pages/RateCardsPage';
import { HomePage } from '@/pages/HomePage';
import { InspectionDetailPage } from '@/pages/InspectionDetailPage';
import { InspectionNewPage } from '@/pages/InspectionNewPage';
import { InspectionsPage } from '@/pages/InspectionsPage';
import { InvoiceDetailPage } from '@/pages/InvoiceDetailPage';
import { InvoiceNewPage } from '@/pages/InvoiceNewPage';
import { InvoicesPage } from '@/pages/InvoicesPage';
import { LeadDetailPage } from '@/pages/LeadDetailPage';
import { LeadNewPage } from '@/pages/LeadNewPage';
import { LeadPipelinePage } from '@/pages/LeadPipelinePage';
import { LeadsPage } from '@/pages/LeadsPage';
import { LoginPage } from '@/pages/LoginPage';
import { LookupsPage } from '@/pages/LookupsPage';
import { MeasurementDetailPage } from '@/pages/MeasurementDetailPage';
import { MeasurementNewPage } from '@/pages/MeasurementNewPage';
import { MaterialsPage } from '@/pages/MaterialsPage';
import { MeasurementsPage } from '@/pages/MeasurementsPage';
import { IntegrationsPage } from '@/pages/IntegrationsPage';
import { StormAlertsPage } from '@/pages/StormAlertsPage';
import { StormImportsPage } from '@/pages/StormImportsPage';
import { StormMapPage } from '@/pages/StormMapPage';
import { StormSearchPage } from '@/pages/StormSearchPage';
import { StormZonesPage } from '@/pages/StormZonesPage';
import { PipelineDashboardPage } from '@/pages/PipelineDashboardPage';
import { PaymentsPage } from '@/pages/PaymentsPage';
import { PropertiesPage } from '@/pages/PropertiesPage';
import { SubcontractorsPage } from '@/pages/SubcontractorsPage';
import { TasksPage } from '@/pages/TasksPage';
import { WorkOrdersPage } from '@/pages/WorkOrdersPage';
import { PipelineStagesPage } from '@/pages/PipelineStagesPage';
import { PricingPage } from '@/pages/PricingPage';
import { ProjectDetailPage } from '@/pages/ProjectDetailPage';
import { ProjectNewPage } from '@/pages/ProjectNewPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { ProposalDetailPage } from '@/pages/ProposalDetailPage';
import { ProposalsPage } from '@/pages/ProposalsPage';
import { PropertyDetailPage } from '@/pages/PropertyDetailPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { UsersPage } from '@/pages/UsersPage';
import { PortalChangePasswordPage } from '@/pages/portal/PortalChangePasswordPage';
import { PortalHomePage } from '@/pages/portal/PortalHomePage';
import {
  PortalDocumentsPage,
  PortalInvoicesPage,
  PortalProjectsPage,
  PortalProposalsPage,
} from '@/pages/portal/PortalListPages';
import { PortalLoginPage } from '@/pages/portal/PortalLoginPage';
import { PortalSessionBootstrap } from './PortalSessionBootstrap';
import { RequireAuth } from './RequireAuth';
import { RequirePermission } from './RequirePermission';
import { RequirePortalAuth } from './RequirePortalAuth';
import { SessionBootstrap } from './SessionBootstrap';

export function AppRouter(): React.ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/portal/*"
          element={
            <PortalSessionBootstrap>
              <Routes>
                <Route element={<AuthLayout />}>
                  <Route path="login" element={<PortalLoginPage />} />
                </Route>
                <Route element={<RequirePortalAuth />}>
                  <Route element={<PortalLayout />}>
                    <Route index element={<PortalHomePage />} />
                    <Route path="change-password" element={<PortalChangePasswordPage />} />
                    <Route path="proposals" element={<PortalProposalsPage />} />
                    <Route path="projects" element={<PortalProjectsPage />} />
                    <Route path="invoices" element={<PortalInvoicesPage />} />
                    <Route path="documents" element={<PortalDocumentsPage />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/portal" replace />} />
              </Routes>
            </PortalSessionBootstrap>
          }
        />

        <Route
          path="*"
          element={
            <SessionBootstrap>
              <Routes>
                <Route element={<AuthLayout />}>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/accept-invite" element={<AcceptInvitePage />} />
                </Route>

                <Route element={<RequireAuth />}>
                  <Route path="/app" element={<AppLayout />}>
                    <Route index element={<HomePage />} />
                    <Route path="change-password" element={<ChangePasswordPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route element={<RequirePermission permission="leads:read" />}>
                      <Route path="leads" element={<LeadsPage />} />
                      <Route path="leads/new" element={<LeadNewPage />} />
                      <Route path="leads/pipeline" element={<LeadPipelinePage />} />
                      <Route path="leads/:id" element={<LeadDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="customers:read" />}>
                      <Route path="customers" element={<CustomersPage />} />
                      <Route path="customers/new" element={<CustomerNewPage />} />
                      <Route path="customers/:id" element={<CustomerDetailPage />} />
                      <Route path="properties/:id" element={<PropertyDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="properties:read" />}>
                      <Route path="properties" element={<PropertiesPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="work_orders:read" />}>
                      <Route path="work-orders" element={<WorkOrdersPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="subcontractors:read" />}>
                      <Route path="subcontractors" element={<SubcontractorsPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="stormEvents:search" />}>
                      <Route path="storm" element={<StormSearchPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="stormEvents:read" />}>
                      <Route path="storm/map" element={<StormMapPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="stormZones:read" />}>
                      <Route path="storm/zones" element={<StormZonesPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="stormAlerts:read" />}>
                      <Route path="storm/alerts" element={<StormAlertsPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="stormEvents:import" />}>
                      <Route path="storm/imports" element={<StormImportsPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="pipeline:read" />}>
                      <Route path="pipeline" element={<PipelineDashboardPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="payments:read" />}>
                      <Route path="payments" element={<PaymentsPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="settings:update" />}>
                      <Route path="integrations" element={<IntegrationsPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="forms:submit" />}>
                      <Route path="field" element={<FieldHomePage />} />
                      <Route path="field/:clientId" element={<FieldFormPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="forms:submit" />}>
                      <Route path="intake" element={<IntakePage />} />
                    </Route>
                    <Route element={<RequirePermission permission="forms:manage" />}>
                      <Route path="forms" element={<FormTemplatesPage />} />
                      <Route path="forms/:id" element={<FormBuilderPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="pricing:read" />}>
                      <Route path="price-catalog" element={<PriceCatalogPage />} />
                      <Route path="quote" element={<QuoteBuilderPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="costs:view" />}>
                      <Route path="rate-cards" element={<RateCardsPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="appointments:read" />}>
                      <Route path="appointments" element={<AppointmentsPage />} />
                      <Route path="appointments/new" element={<AppointmentNewPage />} />
                      <Route path="appointments/calendar" element={<AppointmentCalendarPage />} />
                      <Route path="appointments/:id" element={<AppointmentDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="inspections:read" />}>
                      <Route path="inspections" element={<InspectionsPage />} />
                      <Route path="inspections/new" element={<InspectionNewPage />} />
                      <Route path="inspections/:id" element={<InspectionDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="measurements:read" />}>
                      <Route path="measurements" element={<MeasurementsPage />} />
                      <Route path="measurements/new" element={<MeasurementNewPage />} />
                      <Route path="measurements/solar/new" element={<SolarNewPage />} />
                      <Route element={<RequirePermission permission="measurements:manage" />}>
                        <Route path="measurements/usage" element={<SolarUsagePage />} />
                      </Route>
                      <Route path="measurements/:id" element={<MeasurementDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="estimates:read" />}>
                      <Route path="estimates" element={<EstimatesPage />} />
                      <Route path="estimates/new" element={<EstimateNewPage />} />
                      <Route path="estimates/:id" element={<EstimateDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="pricing:manage" />}>
                      <Route path="pricing" element={<PricingPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="proposals:read" />}>
                      <Route path="proposals" element={<ProposalsPage />} />
                      <Route path="proposals/:id" element={<ProposalDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="materials:read" />}>
                      <Route path="materials" element={<MaterialsPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="projects:read" />}>
                      <Route path="projects" element={<ProjectsPage />} />
                      <Route path="projects/new" element={<ProjectNewPage />} />
                      <Route path="projects/:id" element={<ProjectDetailPage />} />
                      <Route path="tasks" element={<TasksPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="invoices:read" />}>
                      <Route path="invoices" element={<InvoicesPage />} />
                      <Route path="invoices/new" element={<InvoiceNewPage />} />
                      <Route path="invoices/:id" element={<InvoiceDetailPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="communications:read" />}>
                      <Route path="communications" element={<CommunicationsPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="after_sales:read" />}>
                      <Route path="after-sales" element={<AfterSalesPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="analytics:dashboard" />}>
                      <Route path="reports" element={<ReportsPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="users:manage" />}>
                      <Route path="users" element={<UsersPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="settings:update" />}>
                      <Route path="lookups" element={<LookupsPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="pipeline_stages:manage" />}>
                      <Route path="pipeline-stages" element={<PipelineStagesPage />} />
                    </Route>
                    <Route element={<RequirePermission permission="audit:read" />}>
                      <Route path="audit" element={<AuditPage />} />
                    </Route>
                  </Route>
                </Route>

                <Route path="/" element={<Navigate to="/app" replace />} />
                <Route path="*" element={<Navigate to="/app" replace />} />
              </Routes>
            </SessionBootstrap>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
