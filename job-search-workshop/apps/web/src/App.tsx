import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CircleAlert,
  ExternalLink,
  Filter,
  MapPin,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  createApplication,
  getApplications,
  getLatestRun,
  getListings,
  startCollection,
  updateApplication,
  uploadApplicationDocument,
} from "./api";
import type {
  Application,
  ApplicationStatus,
  CollectionRun,
  Listing,
} from "./types";

const APPLICATION_STATUSES: ApplicationStatus[] = [
  "Applied",
  "Screening",
  "Interview",
  "Take-home",
  "Final",
  "Offer",
  "Rejected",
  "Withdrawn",
  "No Response",
];

type SortKey = "title" | "companyName" | "location";
type SortDirection = "asc" | "desc";
type Page = "search" | "applications";

const columns: { key: SortKey; label: string }[] = [
  { key: "title", label: "Role" },
  { key: "companyName", label: "Company" },
  { key: "location", label: "Location" },
];

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "Never";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function todayAsInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateAsInputValue(value: string): string {
  return value.slice(0, 10);
}

export default function App() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [selectedApplication, setSelectedApplication] =
    useState<Application | null>(null);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [jobDescription, setJobDescription] = useState("");
  const [applicationStatus, setApplicationStatus] =
    useState<ApplicationStatus>("Applied");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [coverLetterFile, setCoverLetterFile] = useState<File | null>(null);
  const [appliedDate, setAppliedDate] = useState(todayAsInputValue);
  const [applicationSaved, setApplicationSaved] = useState(false);
  const [savingApplication, setSavingApplication] = useState(false);
  const [run, setRun] = useState<CollectionRun | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<Page>("search");
  const [hideApplied, setHideApplied] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  useEffect(() => {
    let active = true;

    Promise.all([getListings(), getLatestRun(), getApplications()])
      .then(([nextListings, latestRun, nextApplications]) => {
        if (!active) return;
        setListings(nextListings);
        setRun(latestRun);
        setApplications(nextApplications);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load data.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (run?.status !== "running") return;

    const timer = window.setInterval(() => {
      getLatestRun()
        .then((latestRun) => {
          setRun(latestRun);
          if (latestRun?.status !== "running") {
            setCollecting(false);
            void getListings().then((nextListings) => {
              setListings(nextListings);
              setSelectedListing(null);
            });
          }
        })
        .catch((pollError: unknown) => {
          setError(
            pollError instanceof Error
              ? pollError.message
              : "Unable to refresh collection status.",
          );
          setCollecting(false);
        });
    }, 750);

    return () => window.clearInterval(timer);
  }, [run?.status]);

  async function handleCollection(): Promise<void> {
    setError(null);
    setCollecting(true);
    try {
      setRun(await startCollection());
    } catch (collectionError) {
      setError(
        collectionError instanceof Error
          ? collectionError.message
          : "Unable to start collection.",
      );
      setCollecting(false);
    }
  }

  function handleSort(key: SortKey): void {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  const visibleListings = useMemo(
    () =>
      hideApplied
        ? listings.filter(
            (listing) =>
              !applications.some(
                (application) => application.listingId === listing.id,
              ),
          )
        : listings,
    [applications, hideApplied, listings],
  );

  const sortedListings = useMemo(() => {
    if (!sortKey) return visibleListings;
    const direction = sortDirection === "asc" ? 1 : -1;
    return [...visibleListings].sort((a, b) => {
      const aValue = a[sortKey] ?? "";
      const bValue = b[sortKey] ?? "";
      return aValue.localeCompare(bValue) * direction;
    });
  }, [sortKey, sortDirection, visibleListings]);

  async function handleSearch(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      setListings(await getListings(search.trim()));
      setSelectedListing(null);
    } catch (searchError) {
      setError(
        searchError instanceof Error ? searchError.message : "Search failed.",
      );
    }
  }

  function openApplicationForm(listing: Listing, existingApplication?: Application): void {
    setJobDescription(
      existingApplication?.jobDescription ?? listing.summary ?? "",
    );
    setAppliedDate(
      existingApplication
        ? dateAsInputValue(existingApplication.appliedAt)
        : todayAsInputValue(),
    );
    setApplicationStatus(existingApplication?.status ?? "Applied");
    setCvFile(null);
    setCoverLetterFile(null);
    setApplicationSaved(false);
    setApplicationOpen(true);
  }

  function openApplicationEditor(application: Application): void {
    const listing = listings.find((item) => item.id === application.listingId);
    if (!listing) return;
    setSelectedListing(listing);
    openApplicationForm(listing, application);
  }

  async function handleApplicationSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!selectedListing) return;

    setError(null);
    setSavingApplication(true);
    try {
      const existingApplication = applications.find(
        (application) => application.listingId === selectedListing.id,
      );
      const applicationInput = {
        jobTitle: selectedListing.title,
        companyName: selectedListing.companyName,
        jobDescription,
        sourceUrl: selectedListing.sourceUrl,
        status: applicationStatus,
        appliedAt: new Date(`${appliedDate}T12:00:00`).toISOString(),
      };
      let savedApplication = existingApplication
        ? await updateApplication(existingApplication.id, applicationInput)
        : await createApplication({
            listingId: selectedListing.id,
            ...applicationInput,
          });
      for (const [type, file] of [
        ["cv", cvFile],
        ["coverLetter", coverLetterFile],
      ] as const) {
        if (!file) continue;
        const document = await uploadApplicationDocument(
          savedApplication.id,
          type,
          file,
        );
        savedApplication = {
          ...savedApplication,
          documents: [
            ...savedApplication.documents.filter((item) => item.type !== type),
            document,
          ],
        };
      }
      setApplications((current) =>
        existingApplication
          ? current.map((application) =>
              application.id === savedApplication.id
                ? savedApplication
                : application,
            )
          : [savedApplication, ...current],
      );
      setSelectedApplication(savedApplication);
      setApplicationSaved(true);
      setApplicationOpen(false);
    } catch (applicationError) {
      setError(
        applicationError instanceof Error
          ? applicationError.message
          : "Unable to save application.",
      );
    } finally {
      setSavingApplication(false);
    }
  }

  return (
    <div className="app-shell">
      <main>
        <header className="page-header">
          <div>
            <p className="eyebrow">New Zealand software roles</p>
            <h1>Job Finder</h1>
          </div>
          <div className="refresh-control">
            <nav className="page-switcher" aria-label="Main pages">
              <button
                className={activePage === "search" ? "active" : ""}
                onClick={() => setActivePage("search")}
                type="button"
              >
                Job Search
              </button>
              <button
                className={activePage === "applications" ? "active" : ""}
                onClick={() => setActivePage("applications")}
                type="button"
              >
                Applications ({applications.length})
              </button>
            </nav>
            <span className="refresh-timestamp">
              Last refreshed {formatTimestamp(run?.completedAt ?? null)}
            </span>
            <button
              className="primary-action"
              disabled={collecting || run?.status === "running"}
              onClick={() => void handleCollection()}
              type="button"
            >
              <RefreshCw
                className={collecting || run?.status === "running" ? "spin" : ""}
                size={18}
                aria-hidden="true"
              />
              {collecting || run?.status === "running"
                ? "Refreshing"
                : "Refresh"}
            </button>
          </div>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            {error}
          </div>
        )}

        {activePage === "search" && (
          <>
        <section className="listings-section">
          <div className="section-toolbar">
            <div>
              <p className="eyebrow">Current results</p>
              <h2>Software roles ({listings.length})</h2>
            </div>
            <form
              className="search-form"
              onSubmit={(event) => void handleSearch(event)}
            >
              <Search size={18} aria-hidden="true" />
              <label className="sr-only" htmlFor="job-search">
                Search roles
              </label>
              <input
                id="job-search"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Title, company, or location"
                type="search"
                value={search}
              />
              <button type="submit">Search</button>
              <button
                aria-pressed={hideApplied}
                className={`filter-action${hideApplied ? " active" : ""}`}
                onClick={() => setHideApplied((hidden) => !hidden)}
                type="button"
              >
                <Filter size={16} aria-hidden="true" />
                {hideApplied ? "Show applied" : "Hide applied"}
              </button>
            </form>
          </div>

          {loading ? (
            <div className="empty-state" aria-live="polite">
              <RefreshCw className="spin" size={24} aria-hidden="true" />
              <strong>Loading roles</strong>
            </div>
          ) : listings.length === 0 ? (
            <div className="empty-state">
              <strong>No roles found yet</strong>
              <p>
                Select Refresh to check for current vacancies.
              </p>
            </div>
          ) : (
            <div className="listing-table-wrap">
              <table>
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th key={column.key}>
                        <button
                          className="sort-button"
                          onClick={() => handleSort(column.key)}
                          type="button"
                        >
                          {column.label}
                          {sortKey === column.key ? (
                            sortDirection === "asc" ? (
                              <ArrowUp size={14} aria-hidden="true" />
                            ) : (
                              <ArrowDown size={14} aria-hidden="true" />
                            )
                          ) : (
                            <ArrowUpDown size={14} aria-hidden="true" />
                          )}
                        </button>
                      </th>
                    ))}
                    <th>Application</th>
                    <th>Link</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedListings.map((listing) => (
                    <tr
                      className={selectedListing?.id === listing.id ? "selected" : ""}
                      key={listing.id}
                      onClick={() => setSelectedListing(listing)}
                    >
                      <td>
                        <strong>{listing.title}</strong>
                      </td>
                      <td>{listing.companyName}</td>
                      <td>
                        <span className="location">
                          <MapPin size={14} aria-hidden="true" />
                          {listing.location ?? "Not provided"}
                        </span>
                      </td>
                      <td>
                        {applications.some(
                          (application) => application.listingId === listing.id,
                        ) ? (
                          <span className="application-status">
                            {applications.find(
                              (application) => application.listingId === listing.id,
                            )?.status ?? "Applied"}
                          </span>
                        ) : (
                          <span className="not-applied">Not applied</span>
                        )}
                      </td>
                      <td>
                        <a
                          className="icon-link"
                          href={listing.sourceUrl}
                          rel="noreferrer"
                          target="_blank"
                          title="Open original listing"
                        >
                          <ExternalLink size={17} aria-hidden="true" />
                          <span className="sr-only">Open {listing.title}</span>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selectedListing && (
          <section className="listing-detail" aria-labelledby="listing-detail-title">
            <p className="eyebrow">Role details</p>
            <h2 id="listing-detail-title">{selectedListing.title}</h2>
            <dl>
              <div><dt>Company</dt><dd>{selectedListing.companyName}</dd></div>
              <div><dt>Location</dt><dd>{selectedListing.location ?? "Not provided"}</dd></div>
              <div><dt>Collected</dt><dd>{formatTimestamp(selectedListing.lastSeenAt)}</dd></div>
            </dl>
            <p>{selectedListing.summary ?? "Open the original listing for the full job description."}</p>
            <a className="primary-action" href={selectedListing.sourceUrl} rel="noreferrer" target="_blank">
              View original listing <ExternalLink size={18} aria-hidden="true" />
            </a>
            {applications.some(
              (application) => application.listingId === selectedListing.id,
            ) ? (
              <p className="application-detail-status">
                Application status: {applications.find(
                  (application) => application.listingId === selectedListing.id,
                )?.status}
              </p>
            ) : (
              <button
                className="secondary-action"
                onClick={() => openApplicationForm(selectedListing)}
                type="button"
              >
                Mark as applied
              </button>
            )}
            {applicationSaved && (
              <p className="success-message" role="status">
                Application saved.
              </p>
            )}
          </section>
        )}

          </>
        )}

        {activePage === "applications" && (
          <>
        <section className="applications-section" aria-labelledby="applications-title">
          <div className="section-toolbar">
            <div>
              <p className="eyebrow">Your records</p>
              <h2 id="applications-title">Applications ({applications.length})</h2>
            </div>
          </div>
          {applications.length === 0 ? (
            <div className="empty-state compact-empty-state">
              <strong>No applications recorded yet</strong>
              <p>Applied jobs will appear here with their saved job descriptions.</p>
            </div>
          ) : (
            <div className="application-records">
              {applications.map((application) => (
                <article className="application-record" key={application.id}>
                  <div>
                    <p className="eyebrow">
                      {application.status} · Applied {formatTimestamp(application.appliedAt)}
                    </p>
                    <h3>{application.jobTitle}</h3>
                    <p>{application.companyName}</p>
                    <p className="document-summary">
                      CV: {application.documents?.find((document) => document.type === "cv")?.fileName ?? "Not attached"}
                      <br />
                      CL: {application.documents?.find((document) => document.type === "coverLetter")?.fileName ?? "Not attached"}
                    </p>
                  </div>
                  <button
                    className="secondary-action"
                    onClick={() => setSelectedApplication(application)}
                    type="button"
                  >
                    View JD
                  </button>
                  {application.listingId && listings.some(
                    (listing) => listing.id === application.listingId,
                  ) && (
                    <button
                      className="secondary-action"
                      onClick={() => openApplicationEditor(application)}
                      type="button"
                    >
                      Edit application
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        {selectedApplication && (
          <section className="application-detail" aria-labelledby="application-detail-title">
            <div className="detail-heading">
              <div>
                <p className="eyebrow">Saved application</p>
                <h2 id="application-detail-title">{selectedApplication.jobTitle}</h2>
              </div>
              <button
                aria-label="Close saved application"
                className="close-button"
                onClick={() => setSelectedApplication(null)}
                type="button"
              >
                ×
              </button>
            </div>
            <p>
              {selectedApplication.companyName} · {selectedApplication.status} ·
              Applied {formatTimestamp(selectedApplication.appliedAt)}
            </p>
            <div className="saved-job-description">{selectedApplication.jobDescription}</div>
            <a className="secondary-action" href={selectedApplication.sourceUrl} rel="noreferrer" target="_blank">
              Open original listing <ExternalLink size={16} aria-hidden="true" />
            </a>
          </section>
        )}

          </>
        )}

        {applicationOpen && selectedListing && (
          <div className="modal-backdrop" role="presentation">
            <section
              aria-labelledby="application-dialog-title"
              aria-modal="true"
              className="application-dialog"
              role="dialog"
            >
              <p className="eyebrow">Application record</p>
              <h2 id="application-dialog-title">
                Record this application
              </h2>
              <form onSubmit={(event) => void handleApplicationSubmit(event)}>
                <label htmlFor="application-title">Job title</label>
                <input id="application-title" readOnly value={selectedListing.title} />

                <label htmlFor="application-company">Company</label>
                <input id="application-company" readOnly value={selectedListing.companyName} />

                <label htmlFor="application-description">Job description</label>
                <textarea
                  id="application-description"
                  onChange={(event) => setJobDescription(event.target.value)}
                  required
                  rows={9}
                  value={jobDescription}
                />

                <label htmlFor="application-date">Applied date</label>
                <input
                  id="application-date"
                  onChange={(event) => setAppliedDate(event.target.value)}
                  required
                  type="date"
                  value={appliedDate}
                />

                <label htmlFor="application-status">Application status</label>
                <select
                  id="application-status"
                  onChange={(event) =>
                    setApplicationStatus(event.target.value as ApplicationStatus)
                  }
                  value={applicationStatus}
                >
                  {APPLICATION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>

                <label htmlFor="application-cv">CV</label>
                <div>
                  <input
                    accept=".pdf,.doc,.docx,.txt"
                    id="application-cv"
                    onChange={(event) =>
                      setCvFile(event.target.files?.[0] ?? null)
                    }
                    type="file"
                  />
                  <small className="file-note">
                    Optional PDF, DOC, DOCX, or TXT file. Maximum 10 MB.
                  </small>
                </div>

                <label htmlFor="application-cover-letter">Cover letter</label>
                <div>
                  <input
                    accept=".pdf,.doc,.docx,.txt"
                    id="application-cover-letter"
                    onChange={(event) =>
                      setCoverLetterFile(event.target.files?.[0] ?? null)
                    }
                    type="file"
                  />
                  <small className="file-note">
                    Optional PDF, DOC, DOCX, or TXT file. Maximum 10 MB.
                  </small>
                </div>

                <div className="dialog-actions">
                  <button
                    className="secondary-action"
                    onClick={() => setApplicationOpen(false)}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button className="primary-action" disabled={savingApplication} type="submit">
                    {savingApplication
                      ? "Saving..."
                      : applications.some(
                            (application) =>
                              application.listingId === selectedListing.id,
                          )
                        ? "Save changes"
                        : "Save application"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
