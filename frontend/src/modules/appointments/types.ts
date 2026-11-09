export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type Appointment = {
  id: string;
  title: string;
  typeKey: string;
  status: AppointmentStatus;
  customerId: string | null;
  propertyId: string | null;
  leadId: string | null;
  projectId: string | null;
  assignedTo: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  location: string;
  notes: string;
  cancellationReason: string;
  reminder: {
    emailRequested: boolean;
    smsRequested: boolean;
    internalNotifiedAt: string | null;
    emailStatus: string;
    smsStatus: string;
  };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
