export type InspectionStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

export type Inspection = {
  id: string;
  customerId: string;
  propertyId: string;
  appointmentId: string | null;
  leadId: string | null;
  assignedTo: string;
  inspectionDate: string;
  typeKey: string;
  status: InspectionStatus;
  roofCondition: string;
  findings: string;
  damageObservations: string;
  recommendations: string;
  notes: string;
  measurements: {
    totalAreaSqFt: number | null;
    pitch: string;
    notes: string;
  };
  reportGeneratedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
