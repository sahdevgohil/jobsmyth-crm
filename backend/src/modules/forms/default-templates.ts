/**
 * Platform default form templates, transcribed from the client's "CRM Intake & Inspection Forms".
 * They are installed per company (`POST /forms/templates/install-defaults`) and are fully editable
 * afterwards; editing never affects completed submissions (each keeps its template version).
 * Option labels keep the client's wording.
 */
import type { FormDefinition, FormField, FormSection, MeasurementUnit } from './engine.js';
import type { FormKind } from './form.model.js';

export type DefaultTemplate = { key: string; name: string; description: string; kind: FormKind; serviceType: string; definition: FormDefinition };

type Extra = Partial<FormField>;
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const options = (labels: string[]): Array<{ value: string; label: string }> => labels.map((l) => ({ value: slug(l), label: l }));

const text = (id: string, label: string, o: Extra = {}): FormField => ({ id, label, type: 'text', ...o });
const long = (id: string, label: string, o: Extra = {}): FormField => ({ id, label, type: 'long_text', ...o });
const num = (id: string, label: string, o: Extra = {}): FormField => ({ id, label, type: 'number', ...o });
const cur = (id: string, label: string, o: Extra = {}): FormField => ({ id, label, type: 'currency', ...o });
const date = (id: string, label: string, o: Extra = {}): FormField => ({ id, label, type: 'date', ...o });
const dt = (id: string, label: string, o: Extra = {}): FormField => ({ id, label, type: 'datetime', ...o });
const dd = (id: string, label: string, labels: string[], o: Extra = {}): FormField => ({ id, label, type: 'dropdown', options: options(labels), ...o });
const multi = (id: string, label: string, labels: string[], o: Extra = {}): FormField => ({ id, label, type: 'multiselect', options: options(labels), ...o });
const yn = (id: string, label: string, o: Extra = {}): FormField => ({ id, label, type: 'yes_no', ...o });
const rate = (id: string, label: string, o: Extra = {}): FormField => ({
  id, label, type: 'condition_rating', photoRequiredFor: ['damaged', 'needs_replacement'], noteRequiredFor: ['needs_replacement'], ...o,
});
const meas = (id: string, label: string, units: MeasurementUnit[], o: Extra = {}): FormField => ({ id, label, type: 'measurement', units, ...o });
const photos = (id: string, label: string, minPhotos: number, o: Extra = {}): FormField => ({ id, label, type: 'photos', minPhotos, ...o });
const sig = (id: string, label: string, o: Extra = {}): FormField => ({ id, label, type: 'signature', signerNameRequired: true, ...o });
const addr = (id: string, label: string, o: Extra = {}): FormField => ({ id, label, type: 'address', ...o });
const section = (id: string, title: string, fields: FormField[], o: Partial<FormSection> = {}): FormSection => ({ id, title, fields, ...o });

const CONSENT_SMS = 'I agree to receive text messages from the company about my project. Message and data rates may apply. Reply STOP to opt out.';
const CONSENT_EMAIL = 'I agree to receive emails from the company about my project and estimates. I can unsubscribe at any time.';
export const CONSENT_WORDING = { sms: CONSENT_SMS, email: CONSENT_EMAIL, version: 'v1' } as const;

// ------------------------------------------------------------------ intake
const intake: FormDefinition = {
  sections: [
    section('customer', 'Customer', [
      text('first_name', 'First name', { required: true }),
      text('last_name', 'Last name', { required: true }),
      text('second_contact', 'Second contact / spouse / co-owner'),
      text('mobile_phone', 'Mobile phone', { required: true, pattern: '^[0-9+()\\-\\s.]{7,20}$', patternMessage: 'Enter a valid phone number.' }),
      text('email', 'Email', { required: true, pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$', patternMessage: 'Enter a valid email address.' }),
      dd('preferred_contact', 'Preferred contact method', ['Call', 'Text', 'Email']),
      dd('best_time', 'Best time to reach', ['Morning', 'Afternoon', 'Evening', 'Anytime']),
    ]),
    section('property', 'Property', [
      addr('property_address', 'Property address', { required: true, helpText: 'Drop a map pin to record coordinates.' }),
      addr('mailing_address', 'Mailing address'),
      dd('owner_or_renter', 'Owner or renter', ['Owner', 'Renter'], { required: true }),
      dd('property_type', 'Property type', ['Single-family', 'Multi-family', 'Commercial', 'HOA'], { required: true }),
      text('hoa_name', 'HOA name', { visibleWhen: { field: 'property_type', op: 'eq', value: 'hoa' } }),
      text('hoa_contact', 'HOA contact', { visibleWhen: { field: 'property_type', op: 'eq', value: 'hoa' } }),
    ]),
    section('service', 'Service and lead information', [
      multi('services', 'Services interested in', ['Roofing', 'Remodeling', 'Gutters', 'Siding', 'Windows', 'Paint', 'Other'], { required: true }),
      dd('reason_for_call', 'Reason for call', ['Storm damage', 'Leak', 'Age', 'Selling home', 'Remodel', 'Other'], { required: true }),
      dd('lead_source', 'Lead source', ['Door knock', 'Referral', 'Website', 'Google', 'Social', 'Yard sign', 'Repeat customer', 'Other'], { required: true }),
      text('referred_by', 'Referred by', { visibleWhen: { field: 'lead_source', op: 'eq', value: 'referral' } }),
      text('assigned_rep', 'Assigned representative', { required: true, helpText: 'Stores the representative user id; the form shows a picker of active salespeople.' }),
      long('notes', 'Notes'),
    ]),
    section('consent', 'Consent', [
      yn('consent_text', 'Customer consents to text messages', { helpText: CONSENT_SMS }),
      yn('consent_email', 'Customer consents to email', { helpText: CONSENT_EMAIL }),
    ]),
  ],
};

// ------------------------------------------------------------------ roofing job details
const roofingJob: FormDefinition = {
  sections: [
    section('history', 'Property and roof history', [
      num('roof_age_years', 'Approximate roof age (years)', { min: 0, max: 100 }),
      num('stories', 'Number of stories', { min: 1, max: 10 }),
      dd('current_roof_material', 'Current roof material', ['Asphalt shingle', 'Metal', 'Tile', 'Slate', 'Wood shake', 'Flat/TPO', 'Other']),
      yn('known_leaks', 'Known leaks or interior damage'),
      long('damage_description', 'Description of damage'),
      yn('previous_repairs', 'Previous repairs or replacement'),
      num('previous_repair_year', 'Previous repair year', { min: 1900, max: 2100, visibleWhen: { field: 'previous_repairs', op: 'eq', value: true } }),
      yn('existing_warranty', 'Existing warranty'),
      text('warranty_company', 'Warranty company', { visibleWhen: { field: 'existing_warranty', op: 'eq', value: true } }),
      num('year_built', 'Year home built', { min: 1800, max: 2100 }),
      long('access_notes', 'Access notes'),
    ]),
    section('job', 'Job type and timeline', [
      dd('job_type', 'Job type', ['Insurance claim', 'Retail / out of pocket', 'Repair', 'Maintenance'], { required: true }),
      dd('timeline', 'Timeline', ['ASAP', 'Within 30 days', 'Just getting a price']),
      yn('financing_interest', 'Financing interest'),
      text('material_preference', 'Material preference'),
      text('color_preference', 'Color preference'),
    ]),
    section('insurance', 'Insurance claim', [
      text('insurance_company', 'Insurance company', { sensitive: true }),
      text('policy_number', 'Policy number', { sensitive: true }),
      text('claim_number', 'Claim number', { sensitive: true }),
      date('date_of_loss', 'Date of loss'),
      dd('type_of_loss', 'Type of loss', ['Hail', 'Wind', 'Tree', 'Fire', 'Other']),
      yn('claim_filed', 'Claim filed'),
      text('adjuster_name', 'Adjuster name'),
      text('adjuster_phone', 'Adjuster phone'),
      text('adjuster_email', 'Adjuster email'),
      dt('adjuster_meeting', 'Adjuster meeting date and time'),
      cur('deductible', 'Deductible'),
      text('mortgage_company', 'Mortgage company', { sensitive: true }),
      text('mortgage_loan_number', 'Mortgage loan number', { sensitive: true }),
      { id: 'contingency_document', label: 'Contingency or authorization document', type: 'file' },
      sig('contingency_signature', 'Signature reference'),
    ], { visibleWhen: { field: 'job_type', op: 'eq', value: 'insurance_claim' } }),
  ],
};

// ------------------------------------------------------------------ roofing inspection
const slope = (id: string, label: string): FormField[] => [
  rate(`${id}_condition`, `${label} condition`, { withMeasurement: false }),
  num(`${id}_hail_hits`, `${label}: hail hits per 10×10 test square`, { min: 0 }),
  num(`${id}_damaged_count`, `${label}: damaged shingle count`, { min: 0 }),
];
const roofingInspection: FormDefinition = {
  sections: [
    section('general', 'General', [
      date('inspection_date', 'Inspection date', { required: true }),
      text('inspection_time', 'Inspection time', { required: true, pattern: '^([01]?\\d|2[0-3]):[0-5]\\d$', patternMessage: 'Use 24-hour HH:MM.' }),
      text('inspector', 'Inspector', { required: true }),
      text('weather', 'Weather'),
      dd('roof_material', 'Roof material', ['Asphalt shingle', 'Metal', 'Tile', 'Slate', 'Wood shake', 'Flat/TPO', 'Other'], { required: true }),
      num('roofing_layers', 'Roofing layers', { min: 1, max: 5 }),
      num('roof_age_years', 'Approximate roof age (years)', { min: 0, max: 100 }),
      text('roof_pitch', 'Roof pitch', { pattern: '^\\d{1,2}/12$', patternMessage: 'Use rise/12, e.g. 6/12.' }),
      num('slope_count', 'Number of slopes', { min: 1 }),
      dd('walkability', 'Walkable or steep', ['Walkable', 'Steep']),
      yn('harness_required', 'Harness required'),
    ]),
    section('covering', 'Roof covering', [
      ...slope('front', 'Front slope'), ...slope('back', 'Back slope'), ...slope('left', 'Left slope'), ...slope('right', 'Right slope'),
      rate('wind_damage', 'Wind damage'),
      rate('missing_shingles', 'Missing shingles', { withMeasurement: true }),
      rate('creased_shingles', 'Creased shingles', { withMeasurement: true }),
      rate('lifted_shingles', 'Lifted shingles', { withMeasurement: true }),
      rate('granule_loss', 'Granule loss'),
      rate('blistering', 'Blistering'),
      rate('cracking', 'Cracking'),
      rate('curling', 'Curling'),
      text('shingle_brand', 'Shingle brand'),
      text('shingle_product_line', 'Shingle product line'),
      meas('exposure_size', 'Exposure size', ['in'], { min: 0 }),
      rate('ridge_cap', 'Ridge cap'),
      rate('hip_cap', 'Hip cap'),
      rate('starter_condition', 'Starter condition'),
    ]),
    section('flashing', 'Flashing and penetrations', [
      rate('pipe_boots', 'Pipe boots'),
      num('pipe_boot_count', 'Pipe boot count', { min: 0 }),
      rate('chimney_flashing', 'Chimney flashing'),
      rate('chimney_cap', 'Chimney cap'),
      rate('step_flashing', 'Step flashing', { withMeasurement: true }),
      rate('wall_flashing', 'Wall flashing', { withMeasurement: true }),
      rate('skylights', 'Skylights'),
      rate('valleys', 'Valleys'),
      dd('valley_type', 'Open or closed valleys', ['Open', 'Closed']),
      rate('drip_edge', 'Drip edge', { withMeasurement: true }),
    ]),
    section('ventilation', 'Ventilation', [
      rate('box_vents', 'Box vents'), num('box_vent_count', 'Box vent count', { min: 0 }),
      rate('ridge_vent', 'Ridge vent', { withMeasurement: true }),
      rate('turbines', 'Turbines'), num('turbine_count', 'Turbine count', { min: 0 }),
      rate('power_vents', 'Power vents'), num('power_vent_count', 'Power vent count', { min: 0 }),
      rate('soffit_ventilation', 'Soffit ventilation'),
      long('vent_damage', 'Damage to vents'),
    ]),
    section('decking', 'Decking and structure', [
      rate('soft_spots', 'Soft spots'), rate('sagging', 'Sagging'), rate('rot', 'Rot'),
      dd('decking_type', 'Decking type', ['OSB', 'Plywood', 'Plank / skip sheathing', 'Other']),
    ]),
    section('gutters', 'Gutters and soft metals', [
      rate('gutter_dents', 'Gutter dents'), rate('downspout_damage', 'Downspout damage'),
      dd('gutter_size', 'Gutter size', ['5-inch', '6-inch', 'Other']),
      rate('soft_metal_damage', 'Soft metal damage'), rate('ac_fin_damage', 'AC fin damage'),
    ]),
    section('collateral', 'Exterior collateral', [
      rate('siding_collateral', 'Siding'), rate('window_screens', 'Window screens'), rate('window_wraps', 'Window wraps'),
      rate('fence_collateral', 'Fence'), rate('paint_collateral', 'Paint'), rate('outdoor_equipment', 'Outdoor equipment'),
    ]),
    section('interior', 'Interior', [
      rate('ceiling_stains', 'Ceiling stains'), yn('interior_leaks', 'Leaks'), text('interior_room', 'Room'),
      meas('interior_damage_size', 'Damage size', ['SF', 'in']),
      rate('attic_moisture', 'Attic moisture'), yn('attic_daylight', 'Daylight visible'), rate('insulation_condition', 'Insulation condition'),
    ]),
    section('summary', 'Summary', [
      dd('recommendation', 'Recommendation', ['No action', 'Repair', 'Full replacement', 'File a claim'], { required: true }),
      long('scope_notes', 'Estimated scope notes'),
      long('inspector_recommendations', 'Inspector recommendations'),
      sig('homeowner_signature', 'Homeowner acknowledgement signature', { required: true }),
    ]),
    section('photos', 'Required photo checklist', [
      photos('photo_elevations', 'Four elevations', 4),
      photos('photo_slopes', 'Each slope overview', 1),
      photos('photo_test_squares', 'Test squares', 1),
      photos('photo_damage', 'Damage close-ups', 1),
      photos('photo_penetrations', 'Every penetration', 1),
      photos('photo_gutters', 'Gutters', 1),
      photos('photo_interior', 'Interior damage', 1, { visibleWhen: { field: 'interior_leaks', op: 'eq', value: true } }),
    ]),
  ],
};

// ------------------------------------------------------------------ remodeling inspection
const area = (...a: string[]) => ({ field: 'area', op: 'in' as const, value: a });
const remodeling: FormDefinition = {
  sections: [
    section('area', 'Area', [
      dd('area', 'Area', ['Kitchen', 'Bathroom', 'Basement', 'Living space', 'Addition', 'Whole home', 'Exterior', 'Other'], { required: true }),
    ]),
    section('basics', 'Project basics', [
      long('customer_goals', 'Customer goals', { required: true }),
      long('must_haves', 'Must-haves'),
      dd('budget_range', 'Budget range', ['Under $10k', '$10k–$25k', '$25k–$50k', '$50k–$100k', '$100k+']),
      dd('timeline', 'Timeline', ['ASAP', 'Within 3 months', '3–6 months', '6+ months']),
      long('style_preferences', 'Style preferences'),
      long('finish_preferences', 'Finish preferences'),
      photos('inspiration_photos', 'Inspiration photos', 0),
      yn('occupied_during_work', 'Occupied during work'),
    ]),
    section('measurements', 'Measurements', [
      meas('room_length', 'Room length', ['ft'], { min: 0, max: 500 }),
      meas('room_width', 'Room width', ['ft'], { min: 0, max: 500 }),
      meas('ceiling_height', 'Ceiling height', ['ft'], { min: 0, max: 50 }),
      meas('square_footage', 'Calculated square footage', ['SF'], { computed: { formula: 'product', of: ['room_length', 'room_width'], decimals: 1 } }),
      num('window_openings', 'Window openings', { min: 0 }),
      num('door_openings', 'Door openings', { min: 0 }),
      { id: 'sketch', label: 'Sketch', type: 'file' },
      { id: 'floor_plan', label: 'Floor plan upload', type: 'file' },
    ]),
    section('conditions', 'Existing conditions', [
      text('flooring_type', 'Flooring type'), rate('flooring_condition', 'Flooring condition'), rate('subfloor_issues', 'Subfloor issues'),
      rate('walls', 'Walls'), rate('ceilings', 'Ceilings'), rate('drywall', 'Drywall'), rate('plaster', 'Plaster'),
      rate('cracks', 'Cracks'), rate('water_stains', 'Water stains'),
      rate('cabinets', 'Cabinets', { visibleWhen: area('kitchen', 'bathroom', 'whole_home') }),
      rate('countertops', 'Countertops', { visibleWhen: area('kitchen', 'bathroom', 'whole_home') }),
      rate('fixtures', 'Fixtures', { visibleWhen: area('kitchen', 'bathroom', 'whole_home') }),
      rate('water_damage', 'Water damage'), rate('mold', 'Mold'), rate('rot', 'Rot'),
    ]),
    section('systems', 'Systems', [
      text('electrical_panel_size', 'Electrical panel size'), rate('electrical_panel_condition', 'Electrical panel condition'),
      long('outlet_locations', 'Outlet locations'), num('new_circuits', 'New circuits required', { min: 0 }),
      rate('plumbing_supply_lines', 'Plumbing supply lines', { visibleWhen: area('kitchen', 'bathroom', 'basement', 'whole_home', 'addition') }),
      rate('drain_lines', 'Drain lines', { visibleWhen: area('kitchen', 'bathroom', 'basement', 'whole_home', 'addition') }),
      yn('shutoffs_accessible', 'Shutoffs accessible'), text('water_heater', 'Water heater'),
      text('hvac_vents', 'HVAC vents'), text('hvac_returns', 'HVAC returns'),
      yn('load_bearing_walls', 'Load-bearing walls affected'),
    ]),
    section('permits', 'Permits and constraints', [
      yn('permit_likely', 'Permit likely needed'), yn('hoa_approval', 'HOA approval needed'),
      yn('built_before_1978', 'Home built before 1978 — lead-paint testing flag', { helpText: 'A flag only: it does not replace a certified lead-paint inspection.' }),
      long('access', 'Access'), long('parking', 'Parking'), text('dumpster_location', 'Dumpster location'),
    ]),
    section('summary', 'Summary', [
      long('recommended_scope', 'Recommended scope', { required: true }),
      multi('specialists', 'Required specialist', ['Electrician', 'Plumber', 'Engineer']),
      sig('customer_signature', 'Customer acknowledgement signature', { required: true }),
    ]),
  ],
};

// ------------------------------------------------------------------ other service inspections
const common = (): FormSection[] => [
  section('recommendation', 'Recommendation and acknowledgement', [
    long('recommended_scope', 'Recommended scope', { required: true }),
    dd('priority', 'Priority', ['Low', 'Normal', 'High', 'Urgent']),
    yn('storm_damage', 'Storm damage'),
    long('notes', 'Notes'),
    photos('photos_overview', 'Photos', 1, { required: true }),
    sig('customer_signature', 'Customer acknowledgement signature', { required: true }),
  ]),
];
const gutters: FormDefinition = { sections: [
  section('gutters', 'Gutters', [
    meas('linear_feet', 'Linear feet', ['LF'], { required: true }),
    dd('size', 'Size', ['5-inch', '6-inch'], { required: true }),
    text('material', 'Material'), text('color', 'Color'),
    num('downspout_count', 'Downspout count', { min: 0 }), meas('downspout_length', 'Downspout length', ['ft', 'LF']),
    yn('guards', 'Guards'), rate('dents', 'Dents'), rate('separation', 'Separation'), rate('drainage_problems', 'Drainage problems'), rate('fascia_rot', 'Fascia rot'),
  ]), ...common()] };
const siding: FormDefinition = { sections: [
  section('siding', 'Siding', [
    dd('material', 'Material', ['Vinyl', 'Fiber cement', 'Wood', 'Stucco', 'Brick'], { required: true }),
    meas('sf_north', 'Square footage — north elevation', ['SF']), meas('sf_south', 'Square footage — south elevation', ['SF']),
    meas('sf_east', 'Square footage — east elevation', ['SF']), meas('sf_west', 'Square footage — west elevation', ['SF']),
    text('color', 'Color'), text('profile', 'Profile'),
    rate('hail_damage', 'Hail damage'), rate('wind_damage', 'Wind damage'), rate('cracks', 'Cracks'), rate('rot', 'Rot'), rate('house_wrap', 'House wrap condition'),
    dd('matching_availability', 'Matching availability', ['Available', 'Limited', 'Discontinued', 'Unknown']),
  ]), ...common()] };
const windowsDoors: FormDefinition = { sections: [
  section('windows_doors', 'Windows and doors', [
    num('window_count', 'Window count', { min: 0 }), num('door_count', 'Door count', { min: 0 }), long('sizes', 'Sizes'),
    text('frame_material', 'Frame material'),
    rate('broken_seals', 'Broken seals'), rate('fogging', 'Fogging'), rate('screen_damage', 'Screen damage'),
    rate('wrap_damage', 'Wrap damage'), rate('trim_damage', 'Trim damage'), rate('operation_issues', 'Operation issues'),
  ]), ...common()] };
const paint: FormDefinition = { sections: [
  section('paint', 'Exterior paint', [
    multi('surfaces', 'Surfaces', ['Siding', 'Trim', 'Doors', 'Other'], { required: true }),
    meas('square_footage', 'Square footage', ['SF'], { required: true }),
    rate('peeling', 'Peeling'), rate('rot', 'Rot'), text('color_choice', 'Color choice'), long('preparation_required', 'Preparation required'),
  ]), ...common()] };
const fencing: FormDefinition = { sections: [
  section('fencing', 'Fencing', [
    meas('linear_feet', 'Linear feet', ['LF'], { required: true }), text('material', 'Material'), meas('height', 'Height', ['ft']),
    num('gate_count', 'Gates', { min: 0 }), num('damaged_sections', 'Damaged sections', { min: 0 }),
  ]), ...common()] };
const decks: FormDefinition = { sections: [
  section('decks', 'Decks and patios', [
    meas('size', 'Size', ['SF'], { required: true }), text('material', 'Material'),
    rate('rot', 'Rot'), rate('loose_boards', 'Loose boards'), rate('railings', 'Railings'), rate('stairs', 'Stairs'),
    yn('permit_needed', 'Permit needed'),
  ]), ...common()] };
const solar: FormDefinition = { sections: [
  section('solar', 'Solar and skylights', [
    num('panel_count', 'Panel count', { min: 0 }), yn('removal_required', 'Removal required'), yn('reset_required', 'Reset required'),
    num('skylight_count', 'Skylight count', { min: 0 }), long('skylight_sizes', 'Skylight sizes'),
  ]), ...common()] };

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  { key: 'customer_intake', name: 'Customer intake', description: 'First contact: customer, property, service interest, lead source and contact consent.', kind: 'intake', serviceType: '', definition: intake },
  { key: 'roofing_job_details', name: 'Roofing job details', description: 'Roof history, job type, timeline and (for insurance claims) claim details.', kind: 'roofing_job', serviceType: 'roofing', definition: roofingJob },
  { key: 'roofing_inspection', name: 'Roofing inspection', description: 'Full roof inspection with condition ratings, measurements, required photos and homeowner acknowledgement.', kind: 'inspection', serviceType: 'roofing', definition: roofingInspection },
  { key: 'remodeling_inspection', name: 'Remodeling inspection', description: 'Area-based remodeling walkthrough.', kind: 'inspection', serviceType: 'remodeling', definition: remodeling },
  { key: 'gutter_inspection', name: 'Gutter inspection', description: '', kind: 'inspection', serviceType: 'gutters', definition: gutters },
  { key: 'siding_inspection', name: 'Siding inspection', description: '', kind: 'inspection', serviceType: 'siding', definition: siding },
  { key: 'windows_doors_inspection', name: 'Windows and doors inspection', description: '', kind: 'inspection', serviceType: 'windows', definition: windowsDoors },
  { key: 'exterior_paint_inspection', name: 'Exterior paint inspection', description: '', kind: 'inspection', serviceType: 'paint', definition: paint },
  { key: 'fencing_inspection', name: 'Fencing inspection', description: '', kind: 'inspection', serviceType: 'fencing', definition: fencing },
  { key: 'decks_patios_inspection', name: 'Decks and patios inspection', description: '', kind: 'inspection', serviceType: 'decks', definition: decks },
  { key: 'solar_skylights_inspection', name: 'Solar and skylights inspection', description: '', kind: 'inspection', serviceType: 'solar', definition: solar },
];
