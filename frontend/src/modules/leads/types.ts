export type Lead = {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  phone: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    zip: string;
  };
  sourceKey: string;
  stageId: string;
  assignedTo: string;
  serviceInterestKey: string;
  priority?: 'low' | 'normal' | 'high';
  lostReasonKey: string | null;
  convertedCustomerId: string | null;
  convertedAt: string | null;
  notes: string;
  hasOverdueFollowUp?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PipelineStage = {
  id: string;
  name: string;
  category: string;
  order: number;
  isActive: boolean;
};

export type Activity = {
  id: string;
  type: string;
  body: string;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
};
