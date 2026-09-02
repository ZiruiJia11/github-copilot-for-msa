import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "./App";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the empty listing state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ listings: [] }))
      .mockResolvedValueOnce(jsonResponse({ run: null }))
      .mockResolvedValueOnce(jsonResponse({ applications: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(await screen.findByText("No roles found yet")).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("saves a manually entered job description after selecting a role", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          listings: [
            {
              id: "listing-1",
              sourceId: "serko",
              companyName: "Serko",
              title: "Software Engineer",
              location: "Auckland, New Zealand",
              summary: null,
              postedAt: null,
              sourceUrl: "https://example.com/jobs/1",
              firstSeenAt: "2026-09-03T10:00:00.000Z",
              lastSeenAt: "2026-09-03T10:00:00.000Z",
              status: "active",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ run: null }))
      .mockResolvedValueOnce(jsonResponse({ applications: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          application: {
            id: "application-1",
            listingId: "listing-1",
            jobTitle: "Software Engineer",
            companyName: "Serko",
            jobDescription: "Build software for customers.",
            sourceUrl: "https://example.com/jobs/1",
            appliedAt: "2026-09-03T10:00:00.000Z",
            createdAt: "2026-09-03T10:00:00.000Z",
            updatedAt: "2026-09-03T10:00:00.000Z",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.click((await screen.findAllByText("Software Engineer"))[0]);
    await user.click(screen.getByRole("button", { name: "Mark as applied" }));
    await user.type(
      screen.getByLabelText("Job description"),
      "Build software for customers.",
    );
    await user.click(screen.getByRole("button", { name: "Save application" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Application saved.",
    );
    expect(screen.getByText("Applied")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "View JD" }));
    expect(screen.getByText("Build software for customers.")).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/applications",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("opens an existing application for editing", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          listings: [{
            id: "listing-1",
            sourceId: "serko",
            companyName: "Serko",
            title: "Software Engineer",
            location: "Auckland, New Zealand",
            summary: null,
            postedAt: null,
            sourceUrl: "https://example.com/jobs/1",
            firstSeenAt: "2026-09-03T10:00:00.000Z",
            lastSeenAt: "2026-09-03T10:00:00.000Z",
            status: "active",
          }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ run: null }))
      .mockResolvedValueOnce(
        jsonResponse({ applications: [{
          id: "application-1",
          listingId: "listing-1",
          jobTitle: "Software Engineer",
          companyName: "Serko",
          jobDescription: "Previously saved JD.",
          sourceUrl: "https://example.com/jobs/1",
          status: "Applied",
          appliedAt: "2026-09-03T10:00:00.000Z",
          createdAt: "2026-09-03T10:00:00.000Z",
          updatedAt: "2026-09-03T10:00:00.000Z",
        }]}),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.click((await screen.findAllByText("Software Engineer"))[0]);
    expect(screen.getByText("Application status: Applied")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Edit application" }));
    expect(screen.getByLabelText("Job description")).toHaveValue(
      "Previously saved JD.",
    );
  });
});
