/**
 * Deterministic demo dataset builder (pure: no database access).
 *
 * Every document gets a stable `_id` derived from a string key, so re-running the seed upserts the
 * same records instead of duplicating them. Dates are relative to `now` so the dashboard always has
 * "today", "upcoming" and "overdue" data. All people/companies/phones are fictional.
 *
 * Workflow represented:
 *   Lead -> Customer -> Property -> Appointment -> Inspection -> Measurement -> Estimate -> Proposal
 *   -> Project -> Tasks / Work orders / Materials -> Invoice -> Payment -> After-sales
 */
import { createHash } from 'node:crypto';
import { TZDate } from '@date-fns/tz';
import mongoose, { type Model } from 'mongoose';
import { recalcTotals, type LineItemInput } from '../../src/modules/estimates/estimate.calc.js';
import { ActivityModel } from '../../src/modules/activities/activity.model.js';
import { AfterSalesModel } from '../../src/modules/after-sales/after-sales.model.js';
import { AppointmentModel } from '../../src/modules/appointments/appointment.model.js';
import { CommunicationModel } from '../../src/modules/communications/communication.model.js';
import { CustomerModel } from '../../src/modules/customers/customer.model.js';
import { PropertyModel } from '../../src/modules/customers/property.model.js';
import { EstimateModel } from '../../src/modules/estimates/estimate.model.js';
import { InspectionModel } from '../../src/modules/inspections/inspection.model.js';
import { InvoiceModel, PaymentModel } from '../../src/modules/invoices/invoice.model.js';
import { LeadModel } from '../../src/modules/leads/lead.model.js';
import {
  MaterialModel,
  MaterialRequirementModel,
} from '../../src/modules/materials/material.model.js';
import { MeasurementModel } from '../../src/modules/measurements/measurement.model.js';
import { CustomerAccountModel } from '../../src/modules/portal/customer-account.model.js';
import { ProjectModel, ProjectTaskModel } from '../../src/modules/projects/project.model.js';
import { ProposalModel } from '../../src/modules/proposals/proposal.model.js';
import { SubcontractorModel } from '../../src/modules/subcontractors/subcontractor.model.js';
import { UserModel } from '../../src/modules/users/user.model.js';
import { WorkOrderModel } from '../../src/modules/work-orders/work-order.model.js';
import { buildAddressKey } from '../../src/utils/address-key.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModel = Model<any>;
export type DemoOp = { model: AnyModel; doc: Record<string, unknown> & { _id: mongoose.Types.ObjectId } };

export type DemoBuildInput = {
  now: Date;
  passwordHash: string;
  /** Stage ids by name ("New", "Contacted", ...). */
  stageIds: Record<string, mongoose.Types.ObjectId>;
  /** Existing user ids by email (so re-seeding keeps the same _id). */
  existingUserIds?: Record<string, mongoose.Types.ObjectId>;
};

export const DEMO_EMAIL_DOMAIN = 'demo.legacyroofing.test';
export const DEMO_USERS = [
  { key: 'admin', email: `admin@${DEMO_EMAIL_DOMAIN}`, firstName: 'Avery', lastName: 'Whitfield', role: 'admin' },
  { key: 'sp1', email: `maria.delgado@${DEMO_EMAIL_DOMAIN}`, firstName: 'Maria', lastName: 'Delgado', role: 'salesperson' },
  { key: 'sp2', email: `tyler.brooks@${DEMO_EMAIL_DOMAIN}`, firstName: 'Tyler', lastName: 'Brooks', role: 'salesperson' },
  { key: 'sp3', email: `priya.nair@${DEMO_EMAIL_DOMAIN}`, firstName: 'Priya', lastName: 'Nair', role: 'salesperson' },
] as const;

export function demoId(key: string): mongoose.Types.ObjectId {
  const hex = createHash('sha1').update(`legacy-demo:${key}`).digest('hex').slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

const FIRST = ['James', 'Linda', 'Carlos', 'Denise', 'Marcus', 'Hannah', 'Roberto', 'Keisha', 'Daniel', 'Olivia', 'Samuel', 'Grace', 'Victor', 'Natalie', 'Andre', 'Julia', 'Ethan', 'Monica', 'Luis', 'Rachel', 'Omar', 'Sofia', 'Brandon', 'Alicia', 'Wesley', 'Tamara', 'Derek', 'Elena', 'Nathan', 'Priscilla', 'Gabriel', 'Whitney', 'Raymond', 'Camila', 'Harold', 'Jasmine', 'Trevor', 'Irene', 'Felix', 'Donna'];
const LAST = ['Alvarez', 'Bennett', 'Castillo', 'Dawson', 'Estrada', 'Fletcher', 'Gutierrez', 'Hawkins', 'Ibarra', 'Jennings', 'Kowalski', 'Lambert', 'Mendoza', 'Nguyen', 'Ortega', 'Patterson', 'Quintero', 'Ramsey', 'Salazar', 'Thornton', 'Underwood', 'Vasquez', 'Whitaker', 'Yates', 'Zamora', 'Holloway', 'Pruitt', 'Callahan', 'Sandoval', 'McBride', 'Okafor', 'Delacroix', 'Banerjee', 'Hutchins', 'Leal', 'Marsh', 'Navarro', 'Overton', 'Pena', 'Rowe'];
const BUSINESSES = ['Brazos Valley Dental Group', 'Lakeline Self-Storage LLC', 'Magnolia Court Apartments'];
const STREETS = ['Oak Ridge Dr', 'Maple Creek Ln', 'Cedar Hollow Ct', 'Bluebonnet Trl', 'Pecan Grove Rd', 'Live Oak Blvd', 'Mesquite Way', 'Willow Bend Dr', 'Prairie Sage Ln', 'Limestone Ridge Rd', 'Cottonwood St', 'Heritage Park Dr'];
const CITIES = [
  { city: 'Austin', zips: ['78701', '78704', '78745', '78759'], area: '512' },
  { city: 'Dallas', zips: ['75201', '75214', '75229', '75248'], area: '214' },
  { city: 'Houston', zips: ['77002', '77025', '77057', '77079'], area: '713' },
  { city: 'San Antonio', zips: ['78205', '78209', '78230', '78258'], area: '210' },
  { city: 'Fort Worth', zips: ['76102', '76107', '76116', '76132'], area: '817' },
  { city: 'Plano', zips: ['75023', '75024', '75074', '75093'], area: '972' },
  { city: 'Arlington', zips: ['76010', '76012', '76016', '76018'], area: '682' },
];
const SOURCES = ['website', 'referral', 'google', 'phone_call', 'facebook', 'door_knocking', 'existing_customer', 'word_of_mouth'];
const SERVICES = ['roof_replacement', 'roof_repair', 'storm_damage_inspection', 'commercial_roofing', 'gutter_replacement'];

type LeadStageKey = 'new' | 'contacted' | 'appt' | 'inspected' | 'estimate' | 'won' | 'lost';
const STAGE_NAMES: Record<LeadStageKey, string> = {
  new: 'New',
  contacted: 'Contacted',
  appt: 'Appointment Set',
  inspected: 'Inspected',
  estimate: 'Estimate Sent',
  won: 'Won',
  lost: 'Lost',
};

const PROJECT_PLAN = [
  { status: 'planning', createdAgo: 34, priority: 'normal' },
  { status: 'scheduled', createdAgo: 38, priority: 'high' },
  { status: 'in_progress', createdAgo: 45, priority: 'high' },
  { status: 'on_hold', createdAgo: 58, priority: 'urgent' },
  { status: 'quality_review', createdAgo: 55, priority: 'normal' },
  { status: 'completed', createdAgo: 75, priority: 'normal' },
  { status: 'completed', createdAgo: 100, priority: 'low' },
] as const;

export function buildDemoOps(input: DemoBuildInput): DemoOp[] {
  const { now, stageIds } = input;
  const rand = mulberry32(20_261_105);
  const ops: DemoOp[] = [];
  const add = (model: AnyModel, doc: DemoOp['doc']): DemoOp['doc'] => {
    ops.push({ model, doc });
    return doc;
  };
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;
  const ago = (days: number, hour = 16): Date => {
    const d = new Date(now.getTime() - days * DAY);
    d.setUTCHours(hour, Math.floor(rand() * 4) * 15, 0, 0);
    return d.getTime() > now.getTime() ? new Date(now.getTime() - HOUR) : d;
  };
  const clampPast = (d: Date): Date => (d.getTime() > now.getTime() ? new Date(now.getTime() - 5 * 60_000) : d);
  /** Business-hours slot (company time zone) `dayOffset` days from today. */
  const localSlot = (dayOffset: number, hour: number): Date => {
    const l = new TZDate(now, 'America/Chicago');
    return new Date(new TZDate(l.getFullYear(), l.getMonth(), l.getDate() + dayOffset, hour, 0, 0, 'America/Chicago').getTime());
  };
  const stamps = (createdAt: Date) => ({ createdAt, updatedAt: createdAt });

  // ---------------------------------------------------------------- users
  const users: Record<string, mongoose.Types.ObjectId> = {};
  for (const u of DEMO_USERS) {
    const id = input.existingUserIds?.[u.email] ?? demoId(`user:${u.key}`);
    users[u.key] = id;
    add(UserModel, {
      _id: id,
      email: u.email,
      passwordHash: input.passwordHash,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      phone: '+15125550100',
      isActive: true,
      receivesLeads: u.role === 'salesperson',
      mustChangePassword: false,
      ...stamps(ago(120)),
    });
  }
  const adminId = users.admin as mongoose.Types.ObjectId;
  const salesKeys = ['sp1', 'sp2', 'sp3'] as const;
  const salesId = (i: number): mongoose.Types.ObjectId => users[salesKeys[i % 3] as string] as mongoose.Types.ObjectId;

  // ---------------------------------------------------------------- catalog
  const materialDefs = [
    { key: 'shingle', name: 'Architectural shingles (30-yr, demo)', unit: 'sq', cost: 11800 },
    { key: 'underlay', name: 'Synthetic underlayment', unit: 'sq', cost: 4200 },
    { key: 'iws', name: 'Ice & water shield (valleys)', unit: 'lf', cost: 310 },
    { key: 'drip', name: 'Aluminum drip edge', unit: 'lf', cost: 215 },
    { key: 'ridge', name: 'Ridge cap shingles', unit: 'lf', cost: 590 },
    { key: 'flashing', name: 'Step flashing & pipe boot kit', unit: 'ea', cost: 38500 },
    { key: 'nails', name: 'Coil roofing nails (box)', unit: 'ea', cost: 5800 },
    { key: 'vent', name: 'Ridge vent', unit: 'lf', cost: 480 },
    { key: 'tpo', name: 'TPO membrane (60 mil)', unit: 'sq', cost: 31000 },
    { key: 'iso', name: 'Polyiso insulation board', unit: 'sq', cost: 24500 },
    { key: 'gutter', name: '5" seamless aluminum gutter', unit: 'lf', cost: 940 },
    { key: 'downspout', name: '2x3 downspout', unit: 'lf', cost: 620 },
    { key: 'sealant', name: 'Roofing sealant tube', unit: 'ea', cost: 1450 },
    { key: 'decking', name: 'OSB decking sheet (replacement)', unit: 'ea', cost: 3200 },
  ];
  const materials: Record<string, DemoOp['doc']> = {};
  materialDefs.forEach((m, i) => {
    materials[m.key] = add(MaterialModel, {
      _id: demoId(`material:${m.key}`),
      name: m.name,
      sku: `DEMO-${String(i + 1).padStart(3, '0')}`,
      description: 'Illustrative demo catalogue entry; not company pricing.',
      unit: m.unit,
      costCents: m.cost,
      supplier: i % 2 === 0 ? 'Demo Roofing Supply Co.' : 'Lone Star Building Products (demo)',
      active: true,
      notes: '',
      createdBy: adminId,
      ...stamps(ago(110)),
    });
  });

  const subDefs = [
    { key: 'tearoff', company: 'Lone Star Tear-Off Crew LLC', contact: 'Rigo Santana', cats: ['roofing', 'general_construction'], city: 'San Antonio' },
    { key: 'hillcountry', company: 'Hill Country Roofing Partners', contact: 'Dale Pickett', cats: ['roofing'], city: 'Austin' },
    { key: 'gutters', company: 'Metro Gutter & Sheet Metal', contact: 'Imani Ford', cats: ['gutters', 'exterior_repair'], city: 'Dallas' },
    { key: 'flashing', company: 'Pecos Valley Flashing Co.', contact: 'Wade Hollis', cats: ['roofing', 'exterior_repair'], city: 'Fort Worth' },
    { key: 'waste', company: 'Bluebonnet Waste Services', contact: 'Nora Kim', cats: ['general_construction'], city: 'Houston' },
  ];
  const subs: Record<string, mongoose.Types.ObjectId> = {};
  subDefs.forEach((s, i) => {
    const id = demoId(`sub:${s.key}`);
    subs[s.key] = id;
    add(SubcontractorModel, {
      _id: id,
      companyName: s.company,
      contactName: s.contact,
      email: `office@${s.key}.${DEMO_EMAIL_DOMAIN}`,
      phone: `+1${CITIES.find((c) => c.city === s.city)?.area ?? '512'}5550${130 + i}`,
      address: { line1: `${400 + i * 37} Industrial Pkwy`, line2: '', city: s.city, state: 'TX', zip: '78' + String(200 + i) },
      serviceCategories: s.cats,
      notes: 'Fictional demo subcontractor.',
      active: i !== 4,
      archivedAt: null,
      createdBy: adminId,
      ...stamps(ago(100)),
    });
  });

  // ---------------------------------------------------------------- lead plan
  const plan: LeadStageKey[] = [
    ...Array<LeadStageKey>(6).fill('new'),
    ...Array<LeadStageKey>(5).fill('contacted'),
    ...Array<LeadStageKey>(5).fill('appt'),
    ...Array<LeadStageKey>(4).fill('inspected'),
    ...Array<LeadStageKey>(5).fill('estimate'),
    ...Array<LeadStageKey>(7).fill('won'),
    ...Array<LeadStageKey>(4).fill('lost'),
  ];

  const usedNames = new Set<string>();
  const slotUsed = new Map<string, number>();
  let leadSeq = 0;
  let estSeq = 0;
  let propSeq = 0;
  let invSeq = 0;
  let woSeq = 0;
  let wonIndex = 0;
  let estimateStageIndex = 0;
  let lostIndex = 0;
  let inspectedIndex = 0;

  const makePerson = (i: number): { first: string; last: string; company: string } => {
    for (let tries = 0; tries < 50; tries++) {
      const first = pick(FIRST);
      const last = pick(LAST);
      const key = `${first} ${last}`;
      if (!usedNames.has(key)) {
        usedNames.add(key);
        return { first, last, company: '' };
      }
    }
    return { first: 'Pat', last: `Demo${i}`, company: '' };
  };

  const makeAddress = (n: number) => {
    const c = CITIES[n % CITIES.length] as (typeof CITIES)[number];
    return {
      line1: `${100 + Math.floor(rand() * 8800)} ${pick(STREETS)}`,
      line2: '',
      city: c.city,
      state: 'TX',
      zip: pick(c.zips),
      area: c.area,
    };
  };

  const phoneFor = (area: string, n: number): string => `+1${area}55501${String(n % 100).padStart(2, '0')}`;
  const fmtPhone = (e164: string): string => `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;

  const nextSlot = (userId: mongoose.Types.ObjectId, start: Date): Date => {
    let t = start.getTime();
    for (;;) {
      const k = `${userId.toHexString()}:${t}`;
      if (!slotUsed.has(k)) {
        slotUsed.set(k, 1);
        return new Date(t);
      }
      t += 2 * HOUR;
    }
  };

  type Chain = {
    lead: DemoOp['doc'];
    customer: DemoOp['doc'];
    property: DemoOp['doc'];
    customerId: mongoose.Types.ObjectId;
    propertyId: mongoose.Types.ObjectId;
    ownerId: mongoose.Types.ObjectId;
    name: string;
  };

  const addCustomerWithProperty = (
    key: string,
    ownerId: mongoose.Types.ObjectId,
    p: { first: string; last: string; company: string },
    addr: ReturnType<typeof makeAddress>,
    createdAt: Date,
    email: string,
    phone: string,
    leadId?: mongoose.Types.ObjectId,
  ): { customer: DemoOp['doc']; property: DemoOp['doc'] } => {
    const customerId = demoId(`customer:${key}`);
    const customer = add(CustomerModel, {
      _id: customerId,
      type: p.company ? 'business' : 'individual',
      firstName: p.company ? '' : p.first,
      lastName: p.company ? '' : p.last,
      companyName: p.company,
      email,
      emailNormalized: email,
      phone: fmtPhone(phone),
      phoneE164: phone,
      contacts: p.company ? [{ name: `${p.first} ${p.last}`, role: 'Property manager', phone: fmtPhone(phone), email }] : [],
      mailingAddress: { line1: addr.line1, line2: '', city: addr.city, state: 'TX', zip: addr.zip },
      ownerId,
      notes: leadId ? 'Created from a demo lead.' : 'Existing customer (demo).',
      archivedAt: null,
      createdBy: ownerId,
      ...stamps(createdAt),
    });
    const address = { line1: addr.line1, line2: '', city: addr.city, state: 'TX', zip: addr.zip };
    const property = add(PropertyModel, {
      _id: demoId(`property:${key}:1`),
      customerId,
      address,
      addressKey: buildAddressKey(address),
      propertyTypeKey: p.company ? 'commercial' : 'single_family',
      details: { stories: p.company ? 1 : 1 + Math.floor(rand() * 2), roofAgeYears: 8 + Math.floor(rand() * 17), notes: '' },
      location: {},
      createdBy: ownerId,
      ...stamps(createdAt),
    });
    propSeq++;
    return { customer, property };
  };

  // Builds measurement/estimate line items from roof geometry.
  const measurementFor = (commercial: boolean) => {
    const area = commercial ? 9000 + Math.floor(rand() * 7000) : 1700 + Math.floor(rand() * 2600);
    const factor = commercial ? 1 : 1.08 + rand() * 0.18;
    const roofArea = Math.round(area * factor);
    return {
      totalArea: roofArea,
      facets: commercial ? 4 : 6 + Math.floor(rand() * 10),
      pitch: commercial ? '1/12' : pick(['4/12', '5/12', '6/12', '7/12', '8/12']),
      ridge: Math.round(Math.sqrt(roofArea) * 1.1),
      hip: commercial ? 0 : Math.round(Math.sqrt(roofArea) * 0.8),
      valley: commercial ? 0 : Math.round(Math.sqrt(roofArea) * 0.5),
      eave: Math.round(Math.sqrt(roofArea) * 2.1),
      rake: Math.round(Math.sqrt(roofArea) * 1.2),
    };
  };

  const buildLines = (m: ReturnType<typeof measurementFor>, commercial: boolean): LineItemInput[] => {
    const squares = Math.ceil((m.totalArea / 100) * 1.1);
    const line = (
      id: string,
      description: string,
      kind: 'material' | 'labor' | 'other',
      quantity: number,
      unit: string,
      unitCostCents: number,
    ): LineItemInput => ({ id, description, kind, quantity, unit, unitCostCents, laborCostCents: 0, materialCostCents: 0 });
    const lines: LineItemInput[] = [
      line('l1', 'Tear-off existing roofing', 'labor', squares, 'sq', 7500),
      commercial
        ? line('l2', 'TPO membrane system (60 mil)', 'material', squares, 'sq', 31000)
        : line('l2', 'Architectural shingles (30-yr)', 'material', squares, 'sq', 11800),
      commercial
        ? line('l3', 'Polyiso insulation board', 'material', squares, 'sq', 24500)
        : line('l3', 'Synthetic underlayment', 'material', squares, 'sq', 4200),
      line('l4', 'Aluminum drip edge', 'material', m.eave + m.rake, 'lf', 215),
      line('l5', 'Step flashing & pipe boot kit', 'material', 1, 'ea', 38500),
      line('l6', 'Installation labor', 'labor', squares, 'sq', commercial ? 26500 : 21500),
      line('l7', 'Debris haul-off & disposal', 'other', 1, 'ea', commercial ? 118000 : 62500),
    ];
    if (!commercial) {
      lines.splice(3, 0, line('l8', 'Ridge cap shingles', 'material', m.ridge + m.hip, 'lf', 590));
      if (m.valley > 0) lines.splice(4, 0, line('l9', 'Ice & water shield (valleys)', 'material', m.valley, 'lf', 310));
    }
    lines.push(line('l10', 'Building permit allowance', 'other', 1, 'ea', 17500));
    return lines;
  };

  const roofConditions = ['Moderate granule loss; several lifted shingles along the south slope.', 'Aged shingles at end of service life; brittle at the ridge.', 'Hail bruising on multiple slopes; sealant strips failing.', 'Flashing corrosion at chimney and two pipe penetrations.', 'Good overall; localized wind damage at the rake edge.'];
  const findingsList = ['Soft decking near the north valley.', 'Missing shingles after recent storm; water staining visible in attic.', 'Fascia rot at one gable end.', 'Exposed fasteners and failed pipe boots.'];

  // ---------------------------------------------------------------- per-lead build
  const wonChains: Chain[] = [];
  const estimateChains: Array<{ chain: Chain; est: DemoOp['doc']; prop: DemoOp['doc'] }> = [];

  plan.forEach((stage, i) => {
    leadSeq++;
    const assigned = salesId(i);
    const person = makePerson(i);
    const commercial = i === 7 || i === 24 || i === 33;
    const company = commercial ? (BUSINESSES[[7, 24, 33].indexOf(i)] as string) : '';
    const addr = makeAddress(i);
    const email = `${person.first}.${person.last}${i}@example.test`.toLowerCase();
    const phone = phoneFor(addr.area, 20 + i);
    const leadKey = `lead:${i}`;
    const leadId = demoId(leadKey);
    const wonIdx = stage === 'won' ? wonIndex++ : -1;
    const createdDays: Record<LeadStageKey, number> = {
      new: Math.floor(rand() * 6),
      contacted: 3 + Math.floor(rand() * 11),
      appt: 8 + Math.floor(rand() * 12),
      inspected: 15 + Math.floor(rand() * 20),
      estimate: 20 + Math.floor(rand() * 28),
      won: wonIdx >= 0 ? (PROJECT_PLAN[wonIdx]?.createdAgo ?? 40) + 13 : 0,
      lost: 30 + Math.floor(rand() * 55),
    };
    const created = ago(createdDays[stage], 14 + (i % 5));
    const hasCustomer = stage === 'inspected' || stage === 'estimate' || stage === 'won' || (stage === 'lost' && lostIndex === 0);
    const isLostWithProposal = stage === 'lost' && lostIndex === 0;
    if (stage === 'lost') lostIndex++;

    let customerId: mongoose.Types.ObjectId | null = null;
    let propertyId: mongoose.Types.ObjectId | null = null;
    let customer: DemoOp['doc'] | null = null;
    let property: DemoOp['doc'] | null = null;
    if (hasCustomer) {
      const r = addCustomerWithProperty(
        `lead${i}`,
        assigned,
        { first: person.first, last: person.last, company },
        addr,
        new Date(created.getTime() + 2 * DAY),
        email,
        phone,
        leadId,
      );
      customer = r.customer;
      property = r.property;
      customerId = customer._id;
      propertyId = property._id;
    }

    const convertedAt = stage === 'won' ? new Date(created.getTime() + 12 * DAY) : null;
    const lead = add(LeadModel, {
      _id: leadId,
      firstName: company ? '' : person.first,
      lastName: company ? '' : person.last,
      companyName: company,
      email,
      emailNormalized: email,
      phone: fmtPhone(phone),
      phoneE164: phone,
      address: { line1: addr.line1, line2: '', city: addr.city, state: 'TX', zip: addr.zip },
      addressKey: buildAddressKey({ line1: addr.line1, city: addr.city, state: 'TX', zip: addr.zip }),
      sourceKey: SOURCES[i % SOURCES.length] as string,
      stageId: stageIds[STAGE_NAMES[stage]] as mongoose.Types.ObjectId,
      assignedTo: assigned,
      serviceInterestKey: commercial ? 'commercial_roofing' : (SERVICES[(i * 3) % 5 === 3 ? 0 : (i * 3) % 5] as string),
      priority: stage === 'new' && i % 2 === 0 ? 'high' : stage === 'lost' ? 'low' : i % 7 === 0 ? 'high' : 'normal',
      lostReasonKey: stage === 'lost' ? (['price', 'competitor', 'timing', 'price'][lostIndex - 1] as string) : null,
      convertedCustomerId: stage === 'won' ? customerId : null,
      convertedAt,
      notes: pick(['Homeowner noticed leaks after the last storm.', 'Insurance claim may be involved; confirm coverage with owner.', 'Wants a quote before listing the home.', 'Referred by a neighbor we roofed last year.', 'Prefers phone calls after 5 pm.']),
      createdBy: assigned,
      possibleDuplicateOf: [],
      ...stamps(created),
    });

    // ---- lead activities
    const act = (type: string, body: string, at: Date, extra: Record<string, unknown> = {}) =>
      add(ActivityModel, {
        _id: demoId(`activity:${leadKey}:${ops.length}`),
        entityType: 'lead',
        entityId: leadId,
        type,
        body,
        dueAt: null,
        completedAt: null,
        assignedTo: null,
        createdBy: assigned,
        ...stamps(clampPast(at)),
        ...extra,
      });
    act('system', 'Lead created', created);
    act('assignment', 'Lead assigned to salesperson', new Date(created.getTime() + 60_000), { assignedTo: assigned });
    if (stage !== 'new') act('call', 'Initial call: confirmed address and roof concerns.', new Date(created.getTime() + 1 * DAY));
    if (stage !== 'new') act('stage_change', 'Stage changed to Contacted', new Date(created.getTime() + 1 * DAY));
    if (['appt', 'inspected', 'estimate', 'won', 'lost'].includes(stage)) act('stage_change', 'Stage changed to Appointment Set', new Date(created.getTime() + 2 * DAY));
    if (['inspected', 'estimate', 'won'].includes(stage) || isLostWithProposal) act('stage_change', 'Stage changed to Inspected', new Date(created.getTime() + 4 * DAY));
    if (['estimate', 'won'].includes(stage) || isLostWithProposal) act('stage_change', 'Stage changed to Estimate Sent', new Date(created.getTime() + 6 * DAY));
    if (stage === 'won') act('conversion', 'Lead converted to customer', convertedAt as Date);
    if (stage === 'lost') act('stage_change', 'Stage changed to Lost', new Date(created.getTime() + 15 * DAY));
    // follow-ups: overdue for contacted, upcoming for new / contacted
    if (stage === 'contacted') {
      const overdue = leadSeq % 5 < 3;
      act('follow_up', overdue ? 'Call back about scheduling an inspection.' : 'Send photos of similar projects.', new Date(now.getTime() + (overdue ? -(2 + (leadSeq % 4)) : 1 + (leadSeq % 3)) * DAY), {
        dueAt: new Date(now.getTime() + (overdue ? -(2 + (leadSeq % 4)) : 1 + (leadSeq % 3)) * DAY),
        assignedTo: assigned,
        createdAt: clampPast(new Date(created.getTime() + 1 * DAY)),
      });
    }
    if (stage === 'new' && i % 2 === 1) {
      act('follow_up', 'First-touch call within 24 hours.', now, {
        dueAt: new Date(now.getTime() + DAY),
        assignedTo: assigned,
      });
    }
    if (stage === 'estimate' && estimateStageIndex === 0) {
      act('follow_up', 'Check in on proposal decision.', now, { dueAt: new Date(now.getTime() - 1 * DAY), assignedTo: assigned });
    }
    if (stage === 'inspected' || stage === 'estimate') {
      act('follow_up', 'Walk customer through estimate.', new Date(created.getTime() + 5 * DAY), {
        dueAt: new Date(created.getTime() + 7 * DAY),
        completedAt: new Date(created.getTime() + 7 * DAY),
        assignedTo: assigned,
      });
    }

    // ---- appointments (lead only, no customer yet) ----
    if (stage === 'appt') {
      const [dayOff, hr] = ([[0, 9], [0, 14], [1, 10], [2, 13], [3, 9]][leadSeq % 5] ?? [1, 10]) as [number, number];
      const start = nextSlot(assigned, localSlot(dayOff, hr));
      add(AppointmentModel, {
        _id: demoId(`appointment:${leadKey}`),
        title: `Roof inspection – ${company || `${person.first} ${person.last}`}`,
        typeKey: 'inspection',
        status: dayOff < 2 ? 'confirmed' : 'scheduled',
        leadId,
        assignedTo: assigned,
        startAt: start,
        endAt: new Date(start.getTime() + HOUR),
        timeZone: 'America/Chicago',
        location: `${addr.line1}, ${addr.city}, TX ${addr.zip}`,
        notes: '',
        cancellationReason: '',
        reminder: { emailRequested: false, smsRequested: false, internalNotifiedAt: null, emailStatus: 'not_requested', smsStatus: 'not_requested' },
        createdBy: assigned,
        ...stamps(clampPast(new Date(created.getTime() + 2 * DAY))),
      });
    }
    if (stage === 'contacted' && leadSeq % 5 >= 3) {
      // cancelled appointment
      const start = nextSlot(assigned, ago(2, 15));
      add(AppointmentModel, {
        _id: demoId(`appointment:${leadKey}:cancelled`),
        title: `Roof inspection – ${person.first} ${person.last}`,
        typeKey: 'inspection',
        status: 'cancelled',
        leadId,
        assignedTo: assigned,
        startAt: start,
        endAt: new Date(start.getTime() + HOUR),
        timeZone: 'America/Chicago',
        location: `${addr.line1}, ${addr.city}, TX ${addr.zip}`,
        notes: '',
        cancellationReason: 'Customer asked to reschedule after rain.',
        reminder: { emailRequested: false, smsRequested: false, internalNotifiedAt: null, emailStatus: 'not_requested', smsStatus: 'not_requested' },
        createdBy: assigned,
        ...stamps(clampPast(new Date(created.getTime() + 1 * DAY))),
      });
    }

    if (!hasCustomer || !customerId || !propertyId || !customer) return;

    // ---- customer-linked chain ----
    const chain: Chain = {
      lead, customer, property: property as DemoOp['doc'], customerId, propertyId,
      ownerId: assigned,
      name: company || `${person.first} ${person.last}`,
    };
    const apptStart = nextSlot(assigned, clampPast(new Date(created.getTime() + 3 * DAY)));
    const apptId = demoId(`appointment:${leadKey}:inspection`);
    add(AppointmentModel, {
      _id: apptId,
      title: `Roof inspection – ${chain.name}`,
      typeKey: 'inspection',
      status: 'completed',
      customerId,
      propertyId,
      leadId,
      assignedTo: assigned,
      startAt: apptStart,
      endAt: new Date(apptStart.getTime() + HOUR),
      timeZone: 'America/Chicago',
      location: `${addr.line1}, ${addr.city}, TX ${addr.zip}`,
      notes: '',
      cancellationReason: '',
      reminder: { emailRequested: false, smsRequested: false, internalNotifiedAt: null, emailStatus: 'not_requested', smsStatus: 'not_requested' },
      createdBy: assigned,
      ...stamps(clampPast(new Date(created.getTime() + 2 * DAY))),
    });
    const inspectionId = demoId(`inspection:${leadKey}`);
    const meas = measurementFor(commercial);
    add(InspectionModel, {
      _id: inspectionId,
      customerId,
      propertyId,
      appointmentId: apptId,
      leadId,
      assignedTo: assigned,
      inspectionDate: apptStart,
      typeKey: 'standard',
      status: 'completed',
      roofCondition: pick(roofConditions),
      findings: pick(findingsList),
      damageObservations: stage === 'inspected' && inspectedIndex === 0 ? 'Hail impacts on all slopes; collateral damage on gutters.' : 'Wear consistent with roof age; no active interior leaks observed.',
      recommendations: i % 3 === 0 ? 'Full replacement recommended.' : 'Repair affected slopes; re-inspect in 12 months.',
      notes: '',
      measurements: { totalAreaSqFt: meas.totalArea, pitch: meas.pitch, notes: '' },
      reportGeneratedAt: new Date(apptStart.getTime() + 2 * HOUR),
      createdBy: assigned,
      ...stamps(new Date(apptStart.getTime() + HOUR)),
    });
    if (stage === 'inspected') inspectedIndex++;
    const hasMeasurement = !(stage === 'inspected' && inspectedIndex > 2);
    const measurementId = demoId(`measurement:${leadKey}`);
    if (hasMeasurement) {
      add(MeasurementModel, {
        _id: measurementId,
        propertyId,
        inspectionId,
        customerId,
        source: 'manual',
        provider: 'none',
        providerStatus: 'manual_only',
        measurementDate: apptStart,
        units: 'sq_ft',
        ...meas,
        notes: 'Manual entry from field measurements (demo).',
        createdBy: assigned,
        ...stamps(new Date(apptStart.getTime() + 3 * HOUR)),
      });
    }
    act('note', 'Inspection completed and measurements recorded.', new Date(apptStart.getTime() + 3 * HOUR));

    // ---- estimates / proposals ----
    const wantsEstimate = stage === 'estimate' || stage === 'won' || isLostWithProposal || (stage === 'inspected' && inspectedIndex === 1);
    if (wantsEstimate && hasMeasurement) {
      estSeq++;
      const estCreated = clampPast(new Date(created.getTime() + 5 * DAY));
      const discount = commercial ? 0 : i % 4 === 0 ? 50000 : 0;
      const totals = recalcTotals(buildLines(meas, commercial), discount, 825);
      const estimateStatus = stage === 'won' ? 'accepted' : isLostWithProposal ? 'rejected' : stage === 'inspected' ? 'draft' : estimateStageIndex === 0 ? 'draft' : 'sent';
      const estimateId = demoId(`estimate:${leadKey}`);
      const est = add(EstimateModel, {
        _id: estimateId,
        number: `EST-${now.getUTCFullYear()}-D${String(estSeq).padStart(3, '0')}`,
        customerId,
        propertyId,
        inspectionId,
        measurementId,
        leadId,
        status: estimateStatus,
        version: 1,
        lineItems: totals.lineItems,
        discountCents: totals.discountCents,
        taxRateBps: totals.taxRateBps,
        taxCents: totals.taxCents,
        subtotalCents: totals.subtotalCents,
        totalCents: totals.totalCents,
        notes: 'Demo estimate — illustrative pricing only, not company pricing. Tax rate is an example.',
        validUntil: new Date(estCreated.getTime() + 30 * DAY),
        createdBy: assigned,
        ...stamps(estCreated),
      });

      let proposal: DemoOp['doc'] | null = null;
      if (stage !== 'inspected') {
        const propStatus = stage === 'won' ? 'accepted' : isLostWithProposal ? 'rejected' : estimateStageIndex === 0 ? 'draft' : 'sent';
        const propCreated = clampPast(new Date(estCreated.getTime() + 1 * DAY));
        proposal = add(ProposalModel, {
          _id: demoId(`proposal:${leadKey}`),
          number: `PROP-${now.getUTCFullYear()}-D${String(estSeq).padStart(3, '0')}`,
          customerId,
          propertyId,
          estimateId,
          version: 1,
          status: propStatus,
          lineItems: totals.lineItems,
          discountCents: totals.discountCents,
          taxRateBps: totals.taxRateBps,
          taxCents: totals.taxCents,
          subtotalCents: totals.subtotalCents,
          totalCents: totals.totalCents,
          termsAndConditions: 'Demo terms only. Replace with company-approved proposal terms before real use.',
          paymentSchedule: [
            { label: 'Deposit at approval', percentBps: 5000, amountCents: Math.floor(totals.totalCents / 2) },
            { label: 'Balance at completion', percentBps: 5000, amountCents: totals.totalCents - Math.floor(totals.totalCents / 2) },
          ],
          expirationDate: new Date(propCreated.getTime() + 30 * DAY),
          signature: { status: 'not_requested', provider: 'none', providerRef: '', signedAt: null, errorMessage: '' },
          notes: propStatus === 'accepted' ? 'Approved by customer (recorded manually; no e-signature provider connected).' : '',
          lastEmailDelivery: propStatus === 'draft' ? { status: '', message: '', at: null } : { status: 'not_configured', message: 'Email provider not configured; proposal was not emailed.', at: propCreated },
          createdBy: assigned,
          ...stamps(propCreated),
        });
        if (propStatus !== 'draft') {
          add(CommunicationModel, {
            _id: demoId(`comm:email:${leadKey}`),
            customerId,
            leadId,
            projectId: null,
            channel: 'email',
            direction: 'outbound',
            subject: `Proposal ${proposal.number as string}`,
            body: `Hello ${person.first}, your proposal is ready for review.`,
            deliveryStatus: 'not_configured',
            provider: 'none',
            providerMessageId: null,
            sender: 'sales@legacyroofing.demo',
            recipient: email,
            customerVisible: false,
            createdBy: assigned,
            ...stamps(propCreated),
          });
        }
      }
      if (stage === 'estimate') estimateChains.push({ chain, est, prop: proposal as DemoOp['doc'] });
      if (stage === 'estimate') estimateStageIndex++;
      if (stage === 'won' && proposal) {
        buildProject(chain, wonIdx, est, proposal);
        wonChains.push(chain);
      }
    }

    if (stage === 'won') {
      add(CommunicationModel, {
        _id: demoId(`comm:note:${leadKey}`),
        customerId,
        leadId,
        projectId: null,
        channel: 'internal_note',
        direction: 'internal',
        subject: 'Customer preferences',
        body: 'Customer prefers text updates; gate code shared by phone. Dog in the backyard — notify before crew arrives.',
        deliveryStatus: 'received',
        provider: 'none',
        providerMessageId: null,
        sender: '',
        recipient: '',
        customerVisible: false,
        createdBy: assigned,
        ...stamps(clampPast(new Date((convertedAt as Date).getTime() + DAY))),
      });
    }
  });

  // ---------------------------------------------------------------- returning customers (no lead)
  const returning = [0, 1, 2].map((n) => {
    const p = makePerson(100 + n);
    const addr = makeAddress(n + 3);
    const owner = salesId(n);
    const email = `${p.first}.${p.last}.r${n}@example.test`.toLowerCase();
    const phone = phoneFor(addr.area, 70 + n);
    const key = `returning${n}`;
    const { customer, property } = addCustomerWithProperty(key, owner, p, addr, ago(150 + n * 20), email, phone);
    // second property for each returning customer (rental / second home)
    const addr2 = makeAddress(n + 5);
    const address2 = { line1: addr2.line1, line2: '', city: addr2.city, state: 'TX', zip: addr2.zip };
    const property2 = add(PropertyModel, {
      _id: demoId(`property:${key}:2`),
      customerId: customer._id,
      address: address2,
      addressKey: buildAddressKey(address2),
      propertyTypeKey: 'single_family',
      details: { stories: 1, roofAgeYears: 12, notes: 'Rental property.' },
      location: {},
      createdBy: owner,
      ...stamps(ago(140)),
    });
    propSeq++;
    return { customer, property, property2, owner, name: `${p.first} ${p.last}`, addr, email };
  });
  returning.forEach((r, n) => {
    // today / upcoming appointments tied to customers; two have pending inspections
    const [dayOff, hr] = ([[0, 11], [0, 15], [2, 10]][n] ?? [1, 10]) as [number, number];
    const start = nextSlot(r.owner, localSlot(dayOff, hr));
    const apptId = demoId(`appointment:${r.customer._id.toHexString()}:${n}`);
    add(AppointmentModel, {
      _id: apptId,
      title: `Roof inspection – ${r.name}`,
      typeKey: n < 2 ? 'inspection' : 'sales_consultation',
      status: 'confirmed',
      customerId: r.customer._id,
      propertyId: n === 0 ? r.property2._id : r.property._id,
      assignedTo: r.owner,
      startAt: start,
      endAt: new Date(start.getTime() + HOUR),
      timeZone: 'America/Chicago',
      location: `${r.addr.line1}, ${r.addr.city}, TX ${r.addr.zip}`,
      notes: '',
      cancellationReason: '',
      reminder: { emailRequested: false, smsRequested: false, internalNotifiedAt: null, emailStatus: 'not_requested', smsStatus: 'not_requested' },
      createdBy: r.owner,
      ...stamps(ago(3)),
    });
    if (n < 2) {
      add(InspectionModel, {
        _id: demoId(`inspection:returning${n}`),
        customerId: r.customer._id,
        propertyId: n === 0 ? r.property2._id : r.property._id,
        appointmentId: apptId,
        assignedTo: r.owner,
        inspectionDate: start,
        typeKey: 'standard',
        status: n === 0 ? 'in_progress' : 'draft',
        roofCondition: '',
        findings: '',
        damageObservations: '',
        recommendations: '',
        notes: '',
        measurements: {},
        createdBy: r.owner,
        ...stamps(ago(2)),
      });
    }
    add(CommunicationModel, {
      _id: demoId(`comm:sms:returning${n}`),
      customerId: r.customer._id,
      leadId: null,
      projectId: null,
      channel: 'sms',
      direction: 'outbound',
      subject: '',
      body: 'Reminder: your roof inspection is scheduled. Reply to reschedule.',
      deliveryStatus: 'not_configured',
      provider: 'none',
      providerMessageId: null,
      sender: '',
      recipient: '',
      customerVisible: false,
      createdBy: r.owner,
      ...stamps(ago(1)),
    });
  });

  // ---------------------------------------------------------------- projects & finance
  function buildProject(chain: Chain, idx: number, est: DemoOp['doc'], prop: DemoOp['doc']): void {
    const def = PROJECT_PLAN[idx] as (typeof PROJECT_PLAN)[number];
    const projectId = demoId(`project:${idx}`);
    const status = def.status;
    const created = ago(def.createdAgo, 16); // project created ~ proposal acceptance
    const startActual: Record<string, number | undefined> = { in_progress: 3, on_hold: 12, quality_review: 9, completed: idx === 5 ? 40 : 65 };
    const plannedStartOffset: Record<string, number> = { planning: 10, scheduled: 4 };
    const plannedStart = status in plannedStartOffset ? new Date(now.getTime() + (plannedStartOffset[status] as number) * DAY) : ago(startActual[status] ?? 5, 13);
    const plannedEnd = status === 'planning' ? new Date(plannedStart.getTime() + 4 * DAY)
      : status === 'scheduled' ? new Date(plannedStart.getTime() + 3 * DAY)
      : status === 'in_progress' ? new Date(now.getTime() + 2 * DAY)
      : status === 'on_hold' ? new Date(now.getTime() - 2 * DAY)
      : status === 'quality_review' ? new Date(now.getTime() - 1 * DAY)
      : new Date(plannedStart.getTime() + 4 * DAY);
    const actualStart = ['in_progress', 'on_hold', 'quality_review', 'completed'].includes(status) ? plannedStart : undefined;
    const actualEnd = status === 'completed' ? new Date(plannedStart.getTime() + 4 * DAY) : undefined;
    const total = prop.totalCents as number;
    const pm = salesId(idx + 1);
    add(ProjectModel, {
      _id: projectId,
      number: `PRJ-${now.getUTCFullYear()}-D${String(idx + 1).padStart(3, '0')}`,
      customerId: chain.customerId,
      propertyId: chain.propertyId,
      leadId: chain.lead._id,
      estimateId: est._id,
      proposalId: prop._id,
      projectTypeKey: 'roofing',
      projectManagerId: pm,
      assignedEmployeeIds: [pm, adminId],
      status,
      priority: def.priority,
      plannedStartAt: plannedStart,
      plannedEndAt: plannedEnd,
      actualStartAt: actualStart,
      actualEndAt: actualEnd,
      budgetCents: Math.round(total * 0.72),
      notes: status === 'on_hold' ? 'On hold pending deposit and shingle color confirmation.' : '',
      createdBy: chain.ownerId,
      ...stamps(created),
    });
    add(ActivityModel, {
      _id: demoId(`activity:project:${idx}:created`),
      entityType: 'project', entityId: projectId, type: 'system', body: 'Project created from approved proposal',
      dueAt: null, completedAt: null, assignedTo: null, createdBy: chain.ownerId, ...stamps(created),
    });

    // tasks
    const taskDefs: Array<[string, string]> = [
      ['Order materials', status === 'planning' ? 'open' : 'done'],
      ['Confirm shingle color with customer', status === 'on_hold' ? 'blocked' : status === 'planning' ? 'in_progress' : 'done'],
      ['Schedule crew and dumpster', ['planning', 'on_hold'].includes(status) ? 'open' : 'done'],
      ['Final walkthrough & photos', status === 'completed' ? 'done' : status === 'quality_review' ? 'in_progress' : 'open'],
    ];
    taskDefs.forEach(([title, taskStatus], t) => {
      add(ProjectTaskModel, {
        _id: demoId(`task:${idx}:${t}`),
        projectId,
        title,
        assignedTo: t % 2 === 0 ? pm : adminId,
        dueAt: new Date(plannedStart.getTime() + (t - 1) * DAY),
        priority: t === 1 ? 'high' : 'normal',
        status: taskStatus,
        notes: '',
        createdBy: chain.ownerId,
        ...stamps(created),
      });
    });

    // work orders
    const woDefs: Array<{ title: string; sub: string; st: string }> = [
      { title: 'Tear-off and disposal', sub: 'tearoff', st: status === 'planning' ? 'draft' : status === 'scheduled' ? 'scheduled' : status === 'on_hold' ? 'scheduled' : status === 'in_progress' ? 'completed' : 'completed' },
      { title: 'Roof installation', sub: 'hillcountry', st: ['planning', 'scheduled', 'on_hold'].includes(status) ? (status === 'planning' ? 'draft' : 'scheduled') : status === 'in_progress' ? 'in_progress' : 'completed' },
    ];
    if (idx % 3 === 2) woDefs.push({ title: 'Gutter replacement', sub: 'gutters', st: status === 'in_progress' ? 'scheduled' : 'completed' });
    woDefs.forEach((w, k) => {
      woSeq++;
      add(WorkOrderModel, {
        _id: demoId(`wo:${idx}:${k}`),
        number: `WO-${now.getUTCFullYear()}-D${String(woSeq).padStart(3, '0')}`,
        projectId,
        subcontractorId: subs[w.sub],
        assignedEmployeeId: pm,
        title: w.title,
        description: `${w.title} for ${chain.name}.`,
        instructions: 'Protect landscaping and AC units; magnetic sweep of yard at completion.',
        location: '',
        status: w.st,
        plannedStartAt: new Date(plannedStart.getTime() + k * DAY),
        plannedEndAt: new Date(plannedStart.getTime() + (k + 1) * DAY),
        completionNotes: w.st === 'completed' ? 'Completed per scope; photos uploaded to project folder (demo note).' : '',
        issues: status === 'on_hold' && k === 0 ? 'Crew release delayed until deposit received.' : '',
        createdBy: chain.ownerId,
        ...stamps(created),
      });
    });

    // material requirements from the estimate
    const matMap: Record<string, string> = {
      'Architectural shingles (30-yr)': 'shingle', 'Synthetic underlayment': 'underlay', 'Ice & water shield (valleys)': 'iws',
      'Aluminum drip edge': 'drip', 'Ridge cap shingles': 'ridge', 'Step flashing & pipe boot kit': 'flashing',
      'TPO membrane system (60 mil)': 'tpo', 'Polyiso insulation board': 'iso',
    };
    const reqStatus = status === 'planning' ? 'needed' : status === 'scheduled' ? 'ordered' : status === 'on_hold' ? 'ordered' : 'delivered';
    (est.lineItems as LineItemInput[]).forEach((li, k) => {
      const mk = matMap[li.description];
      if (!mk) return;
      add(MaterialRequirementModel, {
        _id: demoId(`matreq:${idx}:${k}`),
        materialId: (materials[mk] as DemoOp['doc'])._id,
        quantity: li.quantity,
        unit: li.unit,
        status: reqStatus,
        notes: '',
        estimateId: est._id,
        proposalId: prop._id,
        projectId,
        createdBy: chain.ownerId,
        ...stamps(created),
      });
    });

    // invoices & payments (integer cents)
    const deposit = Math.floor(total / 2);
    const finalAmt = total - deposit;
    const mkInvoice = (
      tag: 'deposit' | 'final',
      amount: number,
      invoiceDate: Date,
      dueDate: Date,
      invStatus: 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue',
      paid: number,
      paidAt?: Date,
      method = 'check',
    ): void => {
      invSeq++;
      const invId = demoId(`invoice:${idx}:${tag}`);
      const items = [{
        id: 'i1',
        description: tag === 'deposit' ? `Deposit (50%) — proposal ${prop.number as string}` : `Final balance — proposal ${prop.number as string}`,
        kind: 'other', quantity: 1, unit: 'ea', unitCostCents: amount, amountCents: amount,
      }];
      add(InvoiceModel, {
        _id: invId,
        number: `INV-${now.getUTCFullYear()}-D${String(invSeq).padStart(3, '0')}`,
        customerId: chain.customerId,
        propertyId: chain.propertyId,
        projectId,
        estimateId: est._id,
        invoiceDate,
        dueDate,
        status: invStatus,
        lineItems: items,
        discountCents: 0,
        taxRateBps: 0,
        taxCents: 0,
        subtotalCents: amount,
        totalCents: amount,
        amountPaidCents: paid,
        notes: 'Tax is already included in the proposal total.',
        externalAccountingRef: '',
        idempotencyKey: `demo-invoice-${idx}-${tag}`,
        createdBy: chain.ownerId,
        ...stamps(clampPast(invoiceDate)),
      });
      if (paid > 0) {
        const first = tag === 'final' && invStatus === 'partially_paid' ? Math.floor(paid / 2) : paid;
        const parts = first === paid ? [paid] : [first, paid - first];
        parts.forEach((amt, pidx) => {
          add(PaymentModel, {
            _id: demoId(`payment:${idx}:${tag}:${pidx}`),
            invoiceId: invId,
            customerId: chain.customerId,
            amountCents: amt,
            paymentDate: clampPast(new Date((paidAt as Date).getTime() + pidx * 3 * DAY)),
            method: pidx === 0 ? method : 'ach',
            transactionRef: `DEMO-${idx}${tag === 'deposit' ? 'D' : 'F'}${pidx + 1}`,
            status: 'recorded',
            source: 'manual',
            notes: 'Demo payment record.',
            idempotencyKey: `demo-payment-${idx}-${tag}-${pidx}`,
            recordedBy: adminId,
            externalAccountingRef: '',
            ...stamps(clampPast(new Date((paidAt as Date).getTime() + pidx * 3 * DAY))),
          });
        });
      }
    };
    const dDate = new Date(created.getTime() + DAY);
    const dDue = new Date(dDate.getTime() + 14 * DAY);
    switch (idx) {
      case 0: mkInvoice('deposit', deposit, dDate, dDue, 'draft', 0); break;
      case 1: mkInvoice('deposit', deposit, dDate, new Date(now.getTime() + 12 * DAY), 'sent', 0); break;
      case 2: mkInvoice('deposit', deposit, dDate, dDue, 'partially_paid', Math.floor(deposit * 0.6), ago(8, 15), 'ach'); break;
      case 3: mkInvoice('deposit', deposit, ago(30, 15), ago(14, 15), 'overdue', 0); break;
      case 4:
        mkInvoice('deposit', deposit, dDate, dDue, 'paid', deposit, new Date(dDate.getTime() + 4 * DAY), 'credit_card');
        mkInvoice('final', finalAmt, ago(1, 15), new Date(now.getTime() + 10 * DAY), 'sent', 0);
        break;
      case 5:
        mkInvoice('deposit', deposit, dDate, dDue, 'paid', deposit, new Date(dDate.getTime() + 3 * DAY));
        mkInvoice('final', finalAmt, ago(34, 15), ago(4, 15), 'paid', finalAmt, ago(20, 15), 'ach');
        break;
      default:
        mkInvoice('deposit', deposit, dDate, dDue, 'paid', deposit, new Date(dDate.getTime() + 2 * DAY));
        mkInvoice('final', finalAmt, ago(59, 15), ago(29, 15), 'partially_paid', Math.floor(finalAmt * 0.7), ago(45, 15), 'check');
    }

    // project communications
    add(CommunicationModel, {
      _id: demoId(`comm:project-note:${idx}`),
      customerId: chain.customerId, leadId: null, projectId,
      channel: 'internal_note', direction: 'internal',
      subject: 'Crew briefing', body: 'Crew briefed on access, debris plan and material staging area.',
      deliveryStatus: 'received', provider: 'none', providerMessageId: null, sender: '', recipient: '',
      customerVisible: false, createdBy: chain.ownerId, ...stamps(clampPast(new Date(created.getTime() + 2 * DAY))),
    });
    if (idx % 2 === 0) {
      add(CommunicationModel, {
        _id: demoId(`comm:project-sms:${idx}`),
        customerId: chain.customerId, leadId: null, projectId,
        channel: 'sms', direction: 'outbound', subject: '',
        body: 'Your crew arrives tomorrow between 7 and 8 am.', deliveryStatus: 'not_configured', provider: 'none',
        providerMessageId: null, sender: '', recipient: '', customerVisible: false,
        createdBy: chain.ownerId, ...stamps(clampPast(new Date(created.getTime() + 20 * DAY))),
      });
    }

    // after-sales + portal for completed projects
    if (status === 'completed') {
      const done = actualEnd as Date;
      add(AfterSalesModel, {
        _id: demoId(`aftersales:${idx}`),
        projectId,
        customerId: chain.customerId,
        propertyId: chain.propertyId,
        completionConfirmedAt: clampPast(new Date(done.getTime() + DAY)),
        completionConfirmedBy: pm,
        feedbackRating: idx === 5 ? 5 : 4,
        feedbackComment: idx === 5 ? 'Crew was tidy and finished a day early.' : 'Good work; cleanup took an extra visit.',
        warrantyLookupKey: 'workmanship',
        warrantyNotes: 'Coverage terms are per the signed contract. Confirm against company-approved warranty language before quoting.',
        followUpDueAt: idx === 5 ? new Date(now.getTime() + 20 * DAY) : ago(15, 15),
        followUpCompletedAt: idx === 5 ? null : ago(14, 15),
        serviceHistoryNotes: 'Full replacement completed.',
        customerNotesVisible: 'Thank you for choosing Legacy. Contact us with any questions about your new roof.',
        createdBy: pm,
        ...stamps(clampPast(new Date(done.getTime() + DAY))),
      });
      add(CustomerAccountModel, {
        _id: demoId(`portal:${idx}`),
        customerId: chain.customerId,
        email: chain.customer.email as string,
        passwordHash: input.passwordHash,
        firstName: (chain.customer.firstName as string) || 'Customer',
        lastName: (chain.customer.lastName as string) || 'Account',
        isActive: true,
        mustChangePassword: false,
        lastLoginAt: null,
        ...stamps(clampPast(new Date(done.getTime() + 2 * DAY))),
      });
    }
  }

  void wonChains;
  void estimateChains;
  void propSeq;
  return ops;
}
