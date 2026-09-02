import type {
  Application,
  ApplicationDocument,
  CollectionRun,
  Listing,
  Source,
} from "./types";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error ?? `Request failed with status ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

export async function getSources(): Promise<Source[]> {
  const result = await requestJson<{ sources: Source[] }>("/api/sources");
  return result.sources;
}

export async function getListings(search = ""): Promise<Listing[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const result = await requestJson<{ listings: Listing[] }>(
    `/api/listings${query}`,
  );
  return result.listings;
}

export async function getLatestRun(): Promise<CollectionRun | null> {
  const result = await requestJson<{ run: CollectionRun | null }>(
    "/api/collection-runs/latest",
  );
  return result.run;
}

export async function startCollection(): Promise<CollectionRun> {
  const result = await requestJson<{ run: CollectionRun }>(
    "/api/collection-runs",
    { method: "POST" },
  );
  return result.run;
}

export async function createApplication(input: {
  listingId: string;
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  sourceUrl: string;
  status: Application["status"];
  appliedAt: string;
}): Promise<Application> {
  const result = await requestJson<{ application: Application }>(
    "/api/applications",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return result.application;
}

export async function getApplications(): Promise<Application[]> {
  const result = await requestJson<{ applications: Application[] }>(
    "/api/applications",
  );
  return result.applications;
}

export async function updateApplication(
  id: string,
  input: Omit<Parameters<typeof createApplication>[0], "listingId">,
): Promise<Application> {
  const result = await requestJson<{ application: Application }>(
    `/api/applications/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return result.application;
}

export async function uploadApplicationDocument(
  applicationId: string,
  type: ApplicationDocument["type"],
  file: File,
): Promise<ApplicationDocument> {
  const formData = new FormData();
  formData.append("type", type);
  formData.append("file", file);
  const result = await requestJson<{ document: ApplicationDocument }>(
    `/api/applications/${encodeURIComponent(applicationId)}/documents`,
    { method: "POST", body: formData },
  );
  return result.document;
}
