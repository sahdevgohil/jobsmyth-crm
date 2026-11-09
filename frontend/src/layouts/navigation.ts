import {
  BarChart3,
  BellRing,
  CloudHail,
  DatabaseZap,
  Layers,
  MapPin,
  Boxes,
  ClipboardPen,
  Smartphone,
  FileCog,
  Calculator,
  Coins,
  CalendarDays,
  CalendarCheck,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  Funnel,
  Hammer,
  Handshake,
  HardHat,
  Home,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  PlugZap,
  Receipt,
  Ruler,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Tag,
  Truck,
  UserCog,
  Users,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { to: string; label: string; icon: LucideIcon; permission?: string; end?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

/** Sidebar structure. Items without a permission are visible to every signed-in staff user. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/app/pipeline', label: 'Pipeline', icon: Funnel, permission: 'pipeline:read' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/app/leads', label: 'Leads', icon: Handshake, permission: 'leads:read' },
      { to: '/app/customers', label: 'Customers', icon: Users, permission: 'customers:read' },
      { to: '/app/properties', label: 'Properties', icon: Home, permission: 'properties:read' },
      { to: '/app/intake', label: 'Customer intake', icon: ClipboardPen, permission: 'forms:submit' },
    ],
  },
  {
    label: 'Scheduling',
    items: [
      { to: '/app/appointments/calendar', label: 'Calendar', icon: CalendarDays, permission: 'appointments:read' },
      { to: '/app/appointments', label: 'Appointments', icon: CalendarCheck, permission: 'appointments:read', end: true },
      { to: '/app/inspections', label: 'Inspections', icon: ClipboardCheck, permission: 'inspections:read' },
      { to: '/app/field', label: 'Field mode', icon: Smartphone, permission: 'forms:submit' },
    ],
  },
  {
    label: 'Estimation',
    items: [
      { to: '/app/measurements', label: 'Measurements', icon: Ruler, permission: 'measurements:read', end: true },
      { to: '/app/estimates', label: 'Estimates', icon: FileText, permission: 'estimates:read' },
      { to: '/app/proposals', label: 'Proposals', icon: ScrollText, permission: 'proposals:read' },
      { to: '/app/materials', label: 'Materials', icon: Boxes, permission: 'materials:read' },
      { to: '/app/quote', label: 'Good/Better/Best quote', icon: Calculator, permission: 'pricing:read' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/app/projects', label: 'Projects', icon: HardHat, permission: 'projects:read' },
      { to: '/app/tasks', label: 'Tasks', icon: ListChecks, permission: 'projects:read' },
      { to: '/app/work-orders', label: 'Work orders', icon: Wrench, permission: 'work_orders:read' },
      { to: '/app/subcontractors', label: 'Subcontractors', icon: Truck, permission: 'subcontractors:read' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/app/invoices', label: 'Invoices', icon: Receipt, permission: 'invoices:read' },
      { to: '/app/payments', label: 'Payments', icon: CreditCard, permission: 'payments:read' },
      { to: '/app/pricing', label: 'Pricing', icon: Tag, permission: 'pricing:manage' },
      { to: '/app/price-catalog', label: 'Price catalog', icon: Coins, permission: 'pricing:read' },
      { to: '/app/rate-cards', label: 'Subcontractor rates', icon: Truck, permission: 'costs:view' },
    ],
  },
  {
    label: 'Communication',
    items: [
      { to: '/app/communications', label: 'Communications', icon: MessageSquare, permission: 'communications:read' },
      { to: '/app/after-sales', label: 'After-sales', icon: Hammer, permission: 'after_sales:read' },
    ],
  },
  {
    label: 'Storm intelligence',
    items: [
      { to: '/app/storm', label: 'Hail & wind search', icon: CloudHail, permission: 'stormEvents:search', end: true },
      { to: '/app/storm/map', label: 'Storm map', icon: MapPin, permission: 'stormEvents:read' },
      { to: '/app/storm/zones', label: 'Work zones', icon: Layers, permission: 'stormZones:read' },
      { to: '/app/storm/alerts', label: 'Storm alerts', icon: BellRing, permission: 'stormAlerts:read' },
      { to: '/app/storm/imports', label: 'Storm data imports', icon: DatabaseZap, permission: 'stormEvents:import' },
    ],
  },
  {
    label: 'Insights',
    items: [{ to: '/app/reports', label: 'Reports & analytics', icon: BarChart3, permission: 'analytics:dashboard' }],
  },
  {
    label: 'Administration',
    items: [
      { to: '/app/forms', label: 'Form templates', icon: FileCog, permission: 'forms:manage' },
      { to: '/app/users', label: 'Users', icon: UserCog, permission: 'users:manage' },
      { to: '/app/settings', label: 'Settings', icon: Settings },
      { to: '/app/integrations', label: 'Integrations', icon: PlugZap, permission: 'settings:update' },
      { to: '/app/lookups', label: 'Lookups', icon: SlidersHorizontal, permission: 'settings:update' },
      { to: '/app/pipeline-stages', label: 'Pipeline stages', icon: Workflow, permission: 'pipeline_stages:manage' },
      { to: '/app/audit', label: 'Audit logs', icon: ClipboardList, permission: 'audit:read' },
    ],
  },
];

