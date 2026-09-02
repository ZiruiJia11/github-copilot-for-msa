import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { JobFinderRepository } from "./database.js";

describe("job finder API", () => {
  let repository: JobFinderRepository;

  beforeEach(() => {
    repository = new JobFinderRepository(":memory:");
  });

  afterEach(() => {
    repository.close();
  });

  it("reports health and exposes enabled candidate sources", async () => {
    const app = createApp(repository);

    await request(app).get("/api/health").expect(200, { status: "ok" });
    const response = await request(app).get("/api/sources").expect(200);

    expect(response.body.sources).toHaveLength(8);
    expect(
      response.body.sources.filter((source: { enabled: boolean }) => source.enabled),
    ).toHaveLength(2);
    expect(
      response.body.sources
        .filter((source: { enabled: boolean }) => source.enabled)
        .map((source: { id: string }) => source.id),
    ).toEqual(["pushpay", "serko"]);
  });

  it("starts a background collection run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            [
              '<a href="https://job-boards.greenhouse.io/pushpay/jobs/7733604">Senior Software Engineer (C#.NET)</a>',
              '<a href="https://job-boards.greenhouse.io/pushpay/jobs/7733621">Senior Software Engineer (Front-End)</a>',
              '<a href="https://www.serko.com/job-listing/principal-engineer-serkoai-auckland-new-zealand"><span>Principal Engineer - Serko.ai</span><span>Auckland, New Zealand</span></a>',
              '<a href="https://www.serko.com/job-listing/principal-engineer-ai-platform-operations-seattle-united-states">Principal Engineer - AI Platform &amp; Operations Seattle, Washington, United States Full-time</a>',
            ].join(""),
          ),
        ),
      ),
    );
    const app = createApp(repository);

    const startResponse = await request(app)
      .post("/api/collection-runs")
      .expect(202);
    expect(startResponse.body.run.status).toBe("running");

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    const latestResponse = await request(app)
      .get("/api/collection-runs/latest")
      .expect(200);

    expect(latestResponse.body.run).toMatchObject({
      status: "completed",
      sourceCount: 2,
      successCount: 2,
      skippedCount: 0,
    });

    const listingsResponse = await request(app).get("/api/listings").expect(200);
    expect(listingsResponse.body.listings).toHaveLength(3);
    expect(listingsResponse.body.listings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Senior Software Engineer (C#.NET)",
          sourceId: "pushpay",
        }),
        expect.objectContaining({
          title: "Principal Engineer - Serko.ai",
          location: "Auckland, New Zealand",
          sourceId: "serko",
        }),
      ]),
    );
  });

  it("returns an empty listing collection before a source is enabled", async () => {
    const app = createApp(repository);

    await request(app).get("/api/listings?search=engineer").expect(200, {
      listings: [],
    });
  });

  it("creates an application only with the required job details", async () => {
    const app = createApp(repository);

    await request(app)
      .post("/api/applications")
      .send({ jobTitle: "Software Engineer" })
      .expect(400);

    const response = await request(app)
      .post("/api/applications")
      .send({
        jobTitle: "Software Engineer",
        companyName: "Example Company",
        jobDescription: "Build useful software.",
        sourceUrl: "https://example.com/jobs/1",
        appliedAt: "2026-09-03T10:00:00.000Z",
      })
      .expect(201);

    expect(response.body.application).toMatchObject({
      listingId: null,
      jobTitle: "Software Engineer",
      companyName: "Example Company",
      jobDescription: "Build useful software.",
      sourceUrl: "https://example.com/jobs/1",
      appliedAt: "2026-09-03T10:00:00.000Z",
    });

    const applicationsResponse = await request(app)
      .get("/api/applications")
      .expect(200);
    expect(applicationsResponse.body.applications).toEqual([
      expect.objectContaining({
        jobTitle: "Software Engineer",
        companyName: "Example Company",
        jobDescription: "Build useful software.",
      }),
    ]);

    const updateResponse = await request(app)
      .patch(`/api/applications/${response.body.application.id}`)
      .send({
        jobTitle: "Software Engineer",
        companyName: "Example Company",
        jobDescription: "Updated role requirements.",
        sourceUrl: "https://example.com/jobs/1",
        status: "Interview",
        appliedAt: "2026-09-04T10:00:00.000Z",
      })
      .expect(200);
    expect(updateResponse.body.application).toMatchObject({
      jobDescription: "Updated role requirements.",
      status: "Interview",
      appliedAt: "2026-09-04T10:00:00.000Z",
    });
  });
});
