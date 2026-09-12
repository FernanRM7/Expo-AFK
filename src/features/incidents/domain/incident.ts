import type { IncidentCategory, IncidentStatus, IncidentLocation } from '../../../campusops/contracts';

export type Incident = Readonly<{
  id: string;
  title: string;
  description: string;
  category: IncidentCategory;
  status: IncidentStatus;
  location: IncidentLocation;
  reporterId: string;
  assignedTechnicianId: string | null;
  createdAt: string;
}>;