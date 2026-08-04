import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { MOCK_JOBS } from "./jobs/mockJobs";
import type { AuthStore, Credentials, JobsRepository, Session } from "./types";

function makeSession(email = "alex.taylor@example.com"): Session {
  return {
    email,
    displayName: "Alex Taylor",
    authenticatedAt: "2026-08-04T12:00:00.000Z"
  };
}

function makeAuthStore(initialSession: Session | null): AuthStore {
  let session = initialSession;
  return {
    restore: vi.fn(async () => session),
    signIn: vi.fn(async (credentials: Credentials) => {
      session = makeSession(credentials.email);
      return session;
    }),
    signOut: vi.fn(async () => {
      session = null;
    })
  };
}

const jobsRepository: JobsRepository = {
  listJobs: vi.fn(async () => MOCK_JOBS)
};

describe("Athens Lens app", () => {
  it("shows validation, signs in, navigates jobs, and logs out", async () => {
    const user = userEvent.setup();
    const authStore = makeAuthStore(null);
    const { container } = render(<App authStore={authStore} jobsRepository={jobsRepository} />);

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email address"), "alex.taylor@example.com");
    await user.type(screen.getByLabelText("Password"), "demo-password");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: MOCK_JOBS[0].title })).toBeInTheDocument();
    expect(screen.getByText("8", { selector: ".job-count" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: new RegExp(MOCK_JOBS[1].title) }));
    expect(screen.getByRole("heading", { name: MOCK_JOBS[1].title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View job" })).toHaveAttribute("href", MOCK_JOBS[1].applyUrl);
    expect(container.querySelector(".workspace")).toHaveClass("workspace--detail");

    await user.click(screen.getByRole("button", { name: "All jobs" }));
    expect(container.querySelector(".workspace")).toHaveClass("workspace--list");

    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(authStore.signOut).toHaveBeenCalledOnce();
  });

  it("restores a saved session and shows loading before jobs resolve", async () => {
    let resolveJobs: ((jobs: typeof MOCK_JOBS) => void) | undefined;
    const deferredJobs = new Promise<typeof MOCK_JOBS>((resolve) => {
      resolveJobs = resolve;
    });
    const repository: JobsRepository = {
      listJobs: vi.fn(() => deferredJobs)
    };

    render(<App authStore={makeAuthStore(makeSession())} jobsRepository={repository} />);

    expect(await screen.findByText("Loading jobs…")).toBeInTheDocument();
    resolveJobs?.(MOCK_JOBS);
    expect(await screen.findByRole("heading", { name: MOCK_JOBS[0].title })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Welcome back" })).not.toBeInTheDocument();
  });

  it("shows an empty state and retries a failed job load", async () => {
    const user = userEvent.setup();
    const listJobs = vi.fn<JobsRepository["listJobs"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);

    render(
      <App
        authStore={makeAuthStore(makeSession())}
        jobsRepository={{ listJobs }}
      />
    );

    expect(await screen.findByText("Jobs couldn't be loaded.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(listJobs).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No jobs to show yet.")).toBeInTheDocument();
  });
});
