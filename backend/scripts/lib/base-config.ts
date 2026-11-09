import { LookupValueModel } from '../../src/modules/settings/lookup-value.model.js';
import { PipelineStageModel } from '../../src/modules/settings/pipeline-stage.model.js';

export const DEFAULT_LOOKUPS: Array<{ type: string; key: string; label: string; order: number }> = [
  { type: 'lead_source', key: 'door_knocking', label: 'Door knocking', order: 10 },
  { type: 'lead_source', key: 'word_of_mouth', label: 'Word of mouth', order: 20 },
  { type: 'lead_source', key: 'website', label: 'Website', order: 30 },
  { type: 'lead_source', key: 'phone_call', label: 'Phone call', order: 40 },
  { type: 'lead_source', key: 'other', label: 'Other', order: 50 },
  { type: 'lead_source', key: 'google', label: 'Google', order: 60 },
  { type: 'lead_source', key: 'facebook', label: 'Facebook', order: 70 },
  { type: 'lead_source', key: 'referral', label: 'Referral', order: 80 },
  { type: 'lead_source', key: 'existing_customer', label: 'Existing customer', order: 90 },
  { type: 'lost_reason', key: 'price', label: 'Price', order: 10 },
  { type: 'lost_reason', key: 'competitor', label: 'Chose competitor', order: 20 },
  { type: 'lost_reason', key: 'timing', label: 'Timing / not ready', order: 30 },
  { type: 'lost_reason', key: 'other', label: 'Other', order: 40 },
  { type: 'property_type', key: 'single_family', label: 'Single-family', order: 10 },
  { type: 'property_type', key: 'multi_family', label: 'Multi-family', order: 20 },
  { type: 'property_type', key: 'commercial', label: 'Commercial', order: 30 },
  { type: 'appointment_type', key: 'inspection', label: 'Inspection', order: 10 },
  { type: 'appointment_type', key: 'sales_consultation', label: 'Sales consultation', order: 20 },
  { type: 'appointment_type', key: 'estimate_presentation', label: 'Estimate presentation', order: 30 },
  { type: 'appointment_type', key: 'production_walkthrough', label: 'Production walkthrough', order: 40 },
  { type: 'appointment_type', key: 'other', label: 'Other', order: 50 },
  { type: 'project_category', key: 'roofing', label: 'Roofing', order: 10 },
  { type: 'project_category', key: 'gutters', label: 'Gutters', order: 20 },
  { type: 'project_category', key: 'windows', label: 'Windows', order: 30 },
  { type: 'project_category', key: 'remodeling', label: 'Remodeling', order: 40 },
  { type: 'project_category', key: 'exterior_repair', label: 'Exterior repair', order: 50 },
  { type: 'project_category', key: 'interior_repair', label: 'Interior repair', order: 60 },
  { type: 'project_category', key: 'general_construction', label: 'General construction', order: 70 },
  { type: 'project_category', key: 'commercial', label: 'Commercial', order: 80 },
  { type: 'project_category', key: 'roof_replacement', label: 'Roof replacement', order: 110 },
  { type: 'project_category', key: 'roof_repair', label: 'Roof repair', order: 120 },
  { type: 'project_category', key: 'storm_damage_inspection', label: 'Storm damage inspection', order: 130 },
  { type: 'project_category', key: 'commercial_roofing', label: 'Commercial roofing', order: 140 },
  { type: 'project_category', key: 'gutter_replacement', label: 'Gutter replacement', order: 150 },
  { type: 'warranty_type', key: 'manufacturer', label: 'Manufacturer', order: 10 },
  { type: 'warranty_type', key: 'workmanship', label: 'Workmanship', order: 20 },
];

export const DEFAULT_LEAD_STAGES = [
  { name: 'New', category: 'open', order: 1 },
  { name: 'Contacted', category: 'open', order: 2 },
  { name: 'Appointment Set', category: 'open', order: 3 },
  { name: 'Inspected', category: 'open', order: 4 },
  { name: 'Estimate Sent', category: 'open', order: 5 },
  { name: 'Won', category: 'won', order: 6 },
  { name: 'Lost', category: 'lost', order: 7 },
];

export async function seedLookups(): Promise<void> {
  for (const item of DEFAULT_LOOKUPS) {
    await LookupValueModel.updateOne(
      { type: item.type, key: item.key },
      {
        $setOnInsert: {
          type: item.type,
          key: item.key,
          label: item.label,
          order: item.order,
          isActive: true,
        },
      },
      { upsert: true },
    );
  }
  console.log(`Lookups seeded (${DEFAULT_LOOKUPS.length} keys).`);
}

export async function seedPipelineStages(): Promise<void> {
  for (const stage of DEFAULT_LEAD_STAGES) {
    await PipelineStageModel.updateOne(
      { pipeline: 'lead', name: stage.name },
      {
        $setOnInsert: {
          pipeline: 'lead',
          name: stage.name,
          category: stage.category,
          order: stage.order,
          isActive: true,
        },
      },
      { upsert: true },
    );
  }
  console.log(`Lead pipeline stages seeded (${DEFAULT_LEAD_STAGES.length}).`);
}

