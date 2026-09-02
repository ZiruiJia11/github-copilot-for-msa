import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type {
  Application,
  ApplicationStatus,
  ApplicationDocument,
  CollectionRun,
  Listing,
  ListingFilters,
  Source,
} from "./models.js";
import { candidateSources } from "./sources.js";

type SqlValue = string | number | null;

export class JobFinderRepository {
  private readonly database: Database.Database;
  private readonly documentsDirectory: string;

  public constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(databasePath), { recursive: true });
    }
    this.documentsDirectory = `${databasePath === ":memory:" ? "." : dirname(databasePath)}${"/documents"}`;
    mkdirSync(this.documentsDirectory, { recursive: true });

    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.migrate();
    this.seedSources();
  }

  public close(): void {
    this.database.close();
  }

  public listSources(): Source[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, careers_url, endpoint_url, source_type, enabled, policy_status
         FROM sources
         ORDER BY name`,
      )
      .all() as Array<Record<string, SqlValue>>;

    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      careersUrl: String(row.careers_url),
      endpointUrl: row.endpoint_url === null ? null : String(row.endpoint_url),
      sourceType: String(row.source_type),
      enabled: Boolean(row.enabled),
      policyStatus: String(row.policy_status) as Source["policyStatus"],
    }));
  }

  public listListings(filters: ListingFilters = {}): Listing[] {
    const clauses: string[] = [];
    const parameters: Record<string, string> = {};

    if (filters.search) {
      clauses.push(
        "(title LIKE @search OR company_name LIKE @search OR location LIKE @search)",
      );
      parameters.search = `%${filters.search}%`;
    }
    if (filters.company) {
      clauses.push("company_name = @company");
      parameters.company = filters.company;
    }
    if (filters.location) {
      clauses.push("location = @location");
      parameters.location = filters.location;
    }
    if (filters.sourceId) {
      clauses.push("source_id = @sourceId");
      parameters.sourceId = filters.sourceId;
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database
      .prepare(
        `SELECT id, source_id, company_name, title, location, summary, posted_at,
                source_url, first_seen_at, last_seen_at, status
         FROM listings
         ${where}
         ORDER BY last_seen_at DESC, title`,
      )
      .all(parameters) as Array<Record<string, SqlValue>>;

    return rows.map((row) => ({
      id: String(row.id),
      sourceId: String(row.source_id),
      companyName: String(row.company_name),
      title: String(row.title),
      location: row.location === null ? null : String(row.location),
      summary: row.summary === null ? null : String(row.summary),
      postedAt: row.posted_at === null ? null : String(row.posted_at),
      sourceUrl: String(row.source_url),
      firstSeenAt: String(row.first_seen_at),
      lastSeenAt: String(row.last_seen_at),
      status: String(row.status) as Listing["status"],
    }));
  }

  public saveListings(
    source: Source,
    listings: Array<Pick<Listing, "title" | "location" | "summary" | "sourceUrl">>,
  ): void {
    const seenAt = new Date().toISOString();
    const save = this.database.prepare(
      `INSERT INTO listings
         (id, source_id, company_name, title, location, summary, posted_at, source_url, first_seen_at, last_seen_at, status)
       VALUES (@id, @sourceId, @companyName, @title, @location, @summary, NULL, @sourceUrl, @seenAt, @seenAt, 'active')
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, location = excluded.location, summary = excluded.summary,
         last_seen_at = excluded.last_seen_at, status = 'active'`,
    );
    const transaction = this.database.transaction(() => {
      for (const listing of listings) {
        save.run({
          id: createHash("sha256").update(`${source.id}:${listing.sourceUrl}`).digest("hex"),
          sourceId: source.id,
          companyName: source.name,
          ...listing,
          seenAt,
        });
      }
    });
    transaction();
  }

  public createCollectionRun(sourceCount: number): CollectionRun {
    const run: CollectionRun = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: "running",
      sourceCount,
      successCount: 0,
      skippedCount: 0,
      failureCount: 0,
    };

    this.database
      .prepare(
        `INSERT INTO collection_runs
           (id, started_at, completed_at, status, source_count, success_count, skipped_count, failure_count)
         VALUES
           (@id, @startedAt, @completedAt, @status, @sourceCount, @successCount, @skippedCount, @failureCount)`,
      )
      .run(run);

    return run;
  }

  public createApplication(input: {
    listingId: string | null;
    jobTitle: string;
    companyName: string;
    jobDescription: string;
    sourceUrl: string;
    status: ApplicationStatus;
    appliedAt: string;
  }): Application {
    const application: Application = {
      id: crypto.randomUUID(),
      ...input,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      documents: [],
    };

    this.database
      .prepare(
        `INSERT INTO applications
           (id, listing_id, job_title, company_name, job_description, source_url,
            status, applied_at, created_at, updated_at)
         VALUES
           (@id, @listingId, @jobTitle, @companyName, @jobDescription, @sourceUrl,
            @status, @appliedAt, @createdAt, @updatedAt)`,
      )
      .run(application);

    return application;
  }

  public listApplications(): Application[] {
    const rows = this.database
      .prepare(
        `SELECT id, listing_id, job_title, company_name, job_description, source_url,
          status, applied_at, created_at, updated_at
         FROM applications
         ORDER BY applied_at DESC, created_at DESC`,
      )
      .all() as Array<Record<string, SqlValue>>;

    return rows.map((row) => ({
      id: String(row.id),
      listingId: row.listing_id === null ? null : String(row.listing_id),
      jobTitle: String(row.job_title),
      companyName: String(row.company_name),
      jobDescription: String(row.job_description),
      sourceUrl: String(row.source_url),
      status: String(row.status) as ApplicationStatus,
      appliedAt: String(row.applied_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      documents: this.listApplicationDocuments(String(row.id)),
    }));
  }

  public saveApplicationDocument(input: {
    applicationId: string;
    type: ApplicationDocument["type"];
    fileName: string;
    contentType: string;
    data: Buffer;
  }): ApplicationDocument {
    const previous = this.database
      .prepare("SELECT storage_path FROM application_documents WHERE application_id = ? AND type = ?")
      .get(input.applicationId, input.type) as { storage_path?: string } | undefined;
    if (previous?.storage_path) {
      try {
        unlinkSync(previous.storage_path);
      } catch {
        // The database record is still replaced if an old file is already gone.
      }
    }

    const id = crypto.randomUUID();
    const storagePath = `${this.documentsDirectory}/${id}`;
    writeFileSync(storagePath, input.data, { flag: "wx" });
    const document: ApplicationDocument = {
      id,
      applicationId: input.applicationId,
      type: input.type,
      fileName: input.fileName,
      contentType: input.contentType,
      createdAt: new Date().toISOString(),
    };
    this.database.transaction(() => {
      this.database
        .prepare("DELETE FROM application_documents WHERE application_id = ? AND type = ?")
        .run(input.applicationId, input.type);
      this.database
        .prepare(
          `INSERT INTO application_documents
             (id, application_id, type, file_name, content_type, storage_path, created_at)
           VALUES (@id, @applicationId, @type, @fileName, @contentType, @storagePath, @createdAt)`,
        )
        .run({ ...document, storagePath });
    })();
    return document;
  }

  public listApplicationDocuments(applicationId: string): ApplicationDocument[] {
    const rows = this.database
      .prepare(
        `SELECT id, application_id, type, file_name, content_type, created_at
         FROM application_documents WHERE application_id = ? ORDER BY type`,
      )
      .all(applicationId) as Array<Record<string, SqlValue>>;
    return rows.map((row) => ({
      id: String(row.id),
      applicationId: String(row.application_id),
      type: String(row.type) as ApplicationDocument["type"],
      fileName: String(row.file_name),
      contentType: String(row.content_type),
      createdAt: String(row.created_at),
    }));
  }

  public updateApplication(
    id: string,
    input: Pick<
      Application,
      | "jobTitle"
      | "companyName"
      | "jobDescription"
      | "sourceUrl"
      | "status"
      | "appliedAt"
    >,
  ): Application | null {
    const updatedAt = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE applications
         SET job_title = @jobTitle,
             company_name = @companyName,
             job_description = @jobDescription,
             source_url = @sourceUrl,
             status = @status,
             applied_at = @appliedAt,
             updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({ id, ...input, updatedAt });

    return result.changes === 0
      ? null
      : this.listApplications().find((application) => application.id === id) ??
          null;
  }

  public completeCollectionRun(
    id: string,
    status: CollectionRun["status"],
    counts: Pick<
      CollectionRun,
      "successCount" | "skippedCount" | "failureCount"
    >,
  ): void {
    this.database
      .prepare(
        `UPDATE collection_runs
         SET completed_at = @completedAt,
             status = @status,
             success_count = @successCount,
             skipped_count = @skippedCount,
             failure_count = @failureCount
         WHERE id = @id`,
      )
      .run({ id, completedAt: new Date().toISOString(), status, ...counts });
  }

  public addSourceResult(
    runId: string,
    sourceId: string,
    status: "success" | "skipped" | "partial" | "failed",
    diagnostic: string | null,
  ): void {
    this.database
      .prepare(
        `INSERT INTO collection_source_results
           (run_id, source_id, status, diagnostic, completed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(runId, sourceId, status, diagnostic, new Date().toISOString());
  }

  public getLatestCollectionRun(): CollectionRun | null {
    const row = this.database
      .prepare(
        `SELECT id, started_at, completed_at, status, source_count,
                success_count, skipped_count, failure_count
         FROM collection_runs
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .get() as Record<string, SqlValue> | undefined;

    if (!row) {
      return null;
    }

    return {
      id: String(row.id),
      startedAt: String(row.started_at),
      completedAt: row.completed_at === null ? null : String(row.completed_at),
      status: String(row.status) as CollectionRun["status"],
      sourceCount: Number(row.source_count),
      successCount: Number(row.success_count),
      skippedCount: Number(row.skipped_count),
      failureCount: Number(row.failure_count),
    };
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        careers_url TEXT NOT NULL,
        endpoint_url TEXT,
        source_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        policy_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (policy_status IN ('approved', 'pending', 'rejected'))
      );

      CREATE TABLE IF NOT EXISTS listings (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES sources(id),
        company_name TEXT NOT NULL,
        title TEXT NOT NULL,
        location TEXT,
        summary TEXT,
        posted_at TEXT,
        source_url TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'stale', 'unavailable'))
      );

      CREATE TABLE IF NOT EXISTS collection_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
        source_count INTEGER NOT NULL,
        success_count INTEGER NOT NULL,
        skipped_count INTEGER NOT NULL,
        failure_count INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS collection_source_results (
        run_id TEXT NOT NULL REFERENCES collection_runs(id),
        source_id TEXT NOT NULL REFERENCES sources(id),
        status TEXT NOT NULL CHECK (status IN ('success', 'skipped', 'partial', 'failed')),
        diagnostic TEXT,
        completed_at TEXT NOT NULL,
        PRIMARY KEY (run_id, source_id)
      );

      CREATE TABLE IF NOT EXISTS applications (
        id TEXT PRIMARY KEY,
        listing_id TEXT REFERENCES listings(id),
        job_title TEXT NOT NULL,
        company_name TEXT NOT NULL,
        job_description TEXT NOT NULL,
        source_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Applied',
        applied_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS application_documents (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('cv', 'coverLetter')),
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (application_id, type)
      );
    `);

    const applicationColumns = this.database
      .prepare("PRAGMA table_info(applications)")
      .all() as Array<{ name: string }>;
    if (!applicationColumns.some((column) => column.name === "status")) {
      this.database.exec(
        "ALTER TABLE applications ADD COLUMN status TEXT NOT NULL DEFAULT 'Applied'",
      );
    }
  }

  private seedSources(): void {
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO sources
         (id, name, careers_url, endpoint_url, source_type, enabled, policy_status)
       VALUES
         (@id, @name, @careersUrl, @endpointUrl, @sourceType, @enabled, @policyStatus)`,
    );

    const seed = this.database.transaction((sources: Source[]) => {
      for (const source of sources) {
        insert.run({ ...source, enabled: source.enabled ? 1 : 0 });
      }
    });

    seed(candidateSources);

    const update = this.database.prepare(
      `UPDATE sources SET name = @name, careers_url = @careersUrl, endpoint_url = @endpointUrl,
       source_type = @sourceType, enabled = @enabled, policy_status = @policyStatus WHERE id = @id`,
    );
    for (const source of candidateSources) {
      update.run({ ...source, enabled: source.enabled ? 1 : 0 });
    }
  }
}
