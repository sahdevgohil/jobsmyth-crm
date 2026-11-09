/** Allowed forward transitions. Mirrors backend PROJECT_TRANSITIONS, which remains authoritative (invalid moves are rejected with 422). */
export const PROJECT_NEXT: Record<string, string[]> = {
  awaiting_approval: ['approved', 'cancelled'],
  approved: ['planning', 'scheduled', 'cancelled'],
  planning: ['scheduled', 'materials_preparation', 'on_hold', 'cancelled'],
  scheduled: ['materials_preparation', 'in_progress', 'on_hold', 'cancelled'],
  materials_preparation: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['quality_review', 'on_hold', 'completed', 'cancelled'],
  on_hold: ['planning', 'scheduled', 'materials_preparation', 'in_progress', 'cancelled'],
  quality_review: ['completed', 'in_progress', 'cancelled'],
  completed: ['closed'],
  closed: [],
  cancelled: [],
};
