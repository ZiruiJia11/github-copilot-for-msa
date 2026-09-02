import express from "express";
import multer from "multer";

import {
  CollectionAlreadyRunningError,
  CollectionService,
} from "./collection-service.js";
import { JobFinderRepository } from "./database.js";
import type { ApplicationStatus } from "./models.js";

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

const applicationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowed = /\.(pdf|doc|docx|txt)$/i.test(file.originalname);
    if (!allowed) {
      callback(new Error("Only PDF, DOC, DOCX, and TXT files are supported."));
      return;
    }
    callback(null, true);
  },
});

function optionalQuery(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredBody(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function applicationStatus(value: unknown): ApplicationStatus | null {
  return typeof value === "string" &&
      APPLICATION_STATUSES.includes(value as ApplicationStatus)
    ? (value as ApplicationStatus)
    : null;
}

export function createApp(repository: JobFinderRepository) {
  const app = express();
  const collectionService = new CollectionService(repository);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/api/sources", (_request, response) => {
    response.json({ sources: repository.listSources() });
  });

  app.get("/api/listings", (request, response) => {
    const listings = repository.listListings({
      search: optionalQuery(request.query.search),
      company: optionalQuery(request.query.company),
      location: optionalQuery(request.query.location),
      sourceId: optionalQuery(request.query.source),
    });
    response.json({ listings });
  });

  app.get("/api/collection-runs/latest", (_request, response) => {
    response.json({ run: repository.getLatestCollectionRun() });
  });

  app.post("/api/applications", (request, response) => {
    const jobTitle = requiredBody(request.body?.jobTitle);
    const companyName = requiredBody(request.body?.companyName);
    const jobDescription = requiredBody(request.body?.jobDescription);
    const sourceUrl = requiredBody(request.body?.sourceUrl);
    const status = applicationStatus(request.body?.status) ?? "Applied";
    const appliedAt =
      requiredBody(request.body?.appliedAt) ?? new Date().toISOString();

    if (!jobTitle || !companyName || !jobDescription || !sourceUrl) {
      response.status(400).json({
        error:
          "Job title, company name, job description, and source URL are required.",
      });
      return;
    }

    const application = repository.createApplication({
      listingId: requiredBody(request.body?.listingId),
      jobTitle,
      companyName,
      jobDescription,
      sourceUrl,
      status,
      appliedAt,
    });
    response.status(201).json({ application });
  });

  app.get("/api/applications", (_request, response) => {
    response.json({ applications: repository.listApplications() });
  });

  app.post(
    "/api/applications/:id/documents",
    applicationUpload.single("file"),
    (request, response) => {
      const type = request.body?.type;
      const file = request.file;
      const applicationId = requiredBody(request.params.id);
      const applicationExists = repository
        .listApplications()
        .some((application) => application.id === applicationId);
      if (!applicationId || !applicationExists) {
        response.status(404).json({ error: "Application not found." });
        return;
      }
      if (type !== "cv" && type !== "coverLetter") {
        response.status(400).json({ error: "Document type must be cv or coverLetter." });
        return;
      }
      if (!file) {
        response.status(400).json({ error: "A document file is required." });
        return;
      }
      const document = repository.saveApplicationDocument({
        applicationId,
        type,
        fileName: file.originalname.replace(/[^\w.() -]/g, "_").slice(0, 120) || "document",
        contentType: file.mimetype || "application/octet-stream",
        data: file.buffer,
      });
      response.status(201).json({ document });
    },
  );

  app.patch("/api/applications/:id", (request, response) => {
    const jobTitle = requiredBody(request.body?.jobTitle);
    const companyName = requiredBody(request.body?.companyName);
    const jobDescription = requiredBody(request.body?.jobDescription);
    const sourceUrl = requiredBody(request.body?.sourceUrl);
    const appliedAt = requiredBody(request.body?.appliedAt);
    const status = applicationStatus(request.body?.status);

    if (
      !jobTitle ||
      !companyName ||
      !jobDescription ||
      !sourceUrl ||
      !appliedAt ||
      !status
    ) {
      response.status(400).json({
        error:
          "Job title, company name, job description, source URL, and applied date are required.",
      });
      return;
    }

    const application = repository.updateApplication(request.params.id, {
      jobTitle,
      companyName,
      jobDescription,
      sourceUrl,
      status,
      appliedAt,
    });
    if (!application) {
      response.status(404).json({ error: "Application not found." });
      return;
    }
    response.json({ application });
  });

  app.post("/api/collection-runs", (_request, response) => {
    try {
      const run = collectionService.start();
      response.status(202).json({ run });
    } catch (error) {
      if (error instanceof CollectionAlreadyRunningError) {
        response.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  return app;
}
