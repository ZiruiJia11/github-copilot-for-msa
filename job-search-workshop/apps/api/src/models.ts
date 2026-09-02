export type SourceStatus = "approved" | "pending" | "rejected";

export interface Source {
  id: string;
  name: string;
  careersUrl: string;
  endpointUrl: string | null;
  sourceType: string;
  enabled: boolean;
  policyStatus: SourceStatus;
}

export interface Listing {
  id: string;
  sourceId: string;
  companyName: string;
  title: string;
  location: string | null;
  summary: string | null;
  postedAt: string | null;
  sourceUrl: string;
  firstSeenAt: string;
  lastSeenAt: string;
  status: "active" | "stale" | "unavailable";
}

export interface ListingFilters {
  search?: string;
  company?: string;
  location?: string;
  sourceId?: string;
}

export interface CollectionRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "partial" | "failed";
  sourceCount: number;
  successCount: number;
  skippedCount: number;
  failureCount: number;
}

export interface Application {
  id: string;
  listingId: string | null;
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  sourceUrl: string;
  status: ApplicationStatus;
  appliedAt: string;
  createdAt: string;
  updatedAt: string;
  documents: ApplicationDocument[];
}

export interface ApplicationDocument {
  id: string;
  applicationId: string;
  type: "cv" | "coverLetter";
  fileName: string;
  contentType: string;
  createdAt: string;
}

export type ApplicationStatus =
  | "Applied"
  | "Screening"
  | "Interview"
  | "Take-home"
  | "Final"
  | "Offer"
  | "Rejected"
  | "Withdrawn"
  | "No Response";
