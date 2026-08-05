import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { mockInboxRepository } from "./inbox/inboxRepository";
import { MOCK_INBOX_MESSAGES, MOCK_UNREAD_COUNT } from "./inbox/mockInbox";
import { MOCK_JOBS } from "./jobs/mockJobs";
import { resetWorkspaceCacheForTests, useWorkspaceCache } from "./state/workspaceCache";
import type { AuthStore, Credentials, InboxRepository, JobsRepository, Session } from "./types";

function makeSession(username = "Alex Taylor"): Session {
  return {
    username,
    displayName: "Alex Taylor",
    profileId: "profile-1",
    authenticatedAt: "2026-08-04T12:00:00.000Z",
    expiresAt: "2099-08-04T12:00:00.000Z",
    accessToken: "test-access-token"
  };
}

function makeAuthStore(initialSession: Session | null): AuthStore {
  let session = initialSession;
  return {
    restore: vi.fn(async () => session),
    signIn: vi.fn(async (credentials: Credentials) => {
      session = makeSession(credentials.username);
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
  beforeEach(async () => {
    await resetWorkspaceCacheForTests();
    window.location.hash = "#jobs";
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (message: { type?: string; tabId?: number }) => {
          if (message?.type === "ATHENS_LENS_START_RECORDING") {
            return { ok: true, tabId: 42 };
          }
          if (message?.type === "ATHENS_LENS_STOP_RECORDING") {
            return { ok: true, tabId: 42, filename: "athens-lens-recording-test.webm" };
          }
          if (message?.type === "ATHENS_LENS_READ_PAGE_TEXT") {
            return {
              ok: true,
              tabId: 42,
              pageContext: {
                url: "https://example.com/apply",
                title: "Application",
                metaDescription: "",
                visibleText: "Why are you interested in this role?\nWhat is your availability?",
              },
            };
          }
          return { ok: false, error: `Unhandled message ${message?.type || ""}` };
        }),
        lastError: undefined,
      },
    });
  });

  it("shows validation, signs in, navigates jobs, and logs out", async () => {
    const user = userEvent.setup();
    const authStore = makeAuthStore(null);
    const { container } = render(<App authStore={authStore} jobsRepository={jobsRepository} />);

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Enter your username.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Username"), "Alex Taylor");
    await user.type(screen.getByLabelText("Vendor access password"), "demo-password");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: MOCK_JOBS[0].title })).toBeInTheDocument();
    expect(screen.getByText("8", { selector: ".job-count" })).toBeInTheDocument();
    expect(screen.getByText("Product design")).toBeInTheDocument();
    expect(screen.getByText("Hybrid")).toBeInTheDocument();
    expect(screen.getByText("Senior level")).toBeInTheDocument();
    expect(screen.getByText("Posted Aug 3, 2026")).toBeInTheDocument();
    expect(container.querySelector('.company-logo--detail img')).toHaveAttribute(
      "src",
      MOCK_JOBS[0].companyLogoUrl
    );

    await user.click(screen.getByRole("button", { name: new RegExp(MOCK_JOBS[1].title) }));
    expect(screen.getByRole("heading", { name: MOCK_JOBS[1].title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply & record" })).toBeEnabled();
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

  it("renders cached jobs immediately and replaces them with authoritative server data", async () => {
    const cachedJob = { ...MOCK_JOBS[0], id: "cached-job", title: "Cached opportunity" };
    useWorkspaceCache.getState().setJobs("profile-1", [cachedJob], Date.now() - 60_000);
    let resolveJobs: ((jobs: typeof MOCK_JOBS) => void) | undefined;
    const repository: JobsRepository = {
      listJobs: vi.fn(() => new Promise<typeof MOCK_JOBS>((resolve) => {
        resolveJobs = resolve;
      }))
    };

    render(<App authStore={makeAuthStore(makeSession())} jobsRepository={repository} />);

    expect(await screen.findByRole("heading", { name: "Cached opportunity" })).toBeInTheDocument();
    expect(screen.queryByText("Loading jobs…")).not.toBeInTheDocument();
    resolveJobs?.(MOCK_JOBS);
    expect(await screen.findByRole("heading", { name: MOCK_JOBS[0].title })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Cached opportunity" })).not.toBeInTheDocument();
    expect(repository.listJobs).toHaveBeenCalledOnce();
  });

  it("routes to Gmail, opens a security email, and copies its code", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <App
        authStore={makeAuthStore(makeSession())}
        jobsRepository={jobsRepository}
        inboxRepository={mockInboxRepository}
      />
    );

    await screen.findByRole("heading", { name: MOCK_JOBS[0].title });
    await user.click(screen.getByRole("button", { name: /Gmail inbox/ }));

    expect(await screen.findByRole("heading", { name: "Your verification code is 482917" })).toBeInTheDocument();
    expect(container.querySelector(".security-code-card strong")).toHaveTextContent("482917");
    expect(window.location.hash).toBe("#inbox");

    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inbox" }));
    expect(container.querySelector(".workspace")).toHaveClass("workspace--list");
  });

  it("renders Gmail envelopes before asynchronously loaded message bodies", async () => {
    window.location.hash = "#inbox";
    const envelopes = MOCK_INBOX_MESSAGES.map((message) => ({
      ...message,
      preview: "",
      securityCode: undefined,
      body: [],
      bodyLoaded: false
    }));
    let resolveSelectedBody: ((messages: readonly (typeof MOCK_INBOX_MESSAGES)[number][]) => void) | undefined;
    const selectedBody = new Promise<readonly (typeof MOCK_INBOX_MESSAGES)[number][]>((resolve) => {
      resolveSelectedBody = resolve;
    });
    const inboxRepository: InboxRepository = {
      listMessages: vi.fn(async () => ({
        accountEmail: "candidate@example.com",
        messages: envelopes,
        total: envelopes.length,
        unreadCount: MOCK_UNREAD_COUNT
      })),
      loadMessageBodies: vi.fn((_session, messageIds) => messageIds.length === 1
        ? selectedBody
        : new Promise<never>(() => undefined))
    };

    render(
      <App
        authStore={makeAuthStore(makeSession())}
        jobsRepository={jobsRepository}
        inboxRepository={inboxRepository}
      />
    );

    expect(await screen.findByRole("heading", { name: MOCK_INBOX_MESSAGES[0].subject })).toBeInTheDocument();
    expect(screen.getByText("Loading message…")).toBeInTheDocument();
    resolveSelectedBody?.([MOCK_INBOX_MESSAGES[0]]);
    expect(await screen.findByText(MOCK_INBOX_MESSAGES[0].body[0])).toBeInTheDocument();
    expect(inboxRepository.loadMessageBodies).toHaveBeenCalledWith(expect.anything(), [MOCK_INBOX_MESSAGES[0].id]);
  });

  it("starts, restarts, completes, and reviews a live bid recording", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      summary: "Application form detected.",
      answers: [
        {
          question: "Why are you interested in this role?",
          suggestedAnswer: "I am interested because the work matches my background.",
          confidence: "high",
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <App
        authStore={makeAuthStore(makeSession())}
        jobsRepository={jobsRepository}
        inboxRepository={mockInboxRepository}
      />
    );

    await screen.findByRole("heading", { name: MOCK_JOBS[0].title });
    await user.click(screen.getByRole("button", { name: "Apply & record" }));

    expect(screen.getByRole("complementary", { name: "Application recording" })).toBeInTheDocument();
    expect(screen.getByText("Live tab capture · 00:00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restart" }));
    await user.click(screen.getAllByRole("button", { name: "Ask AI" })[0]!);
    expect(screen.getByRole("dialog", { name: "Form answers" })).toBeInTheDocument();
    expect(await screen.findByText("Detected questions")).toBeInTheDocument();
    expect(screen.getByText("Why are you interested in this role?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close AI answers" }));

    await user.click(screen.getByRole("button", { name: /Gmail inbox/ }));
    expect(await screen.findByText(`Recording application (${MOCK_JOBS[0].company})`)).toBeInTheDocument();
    expect(screen.getByText(`Role · ${MOCK_JOBS[0].title}`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Complete Bid" }));
    expect(screen.getByRole("dialog", { name: "Did you submit this bid?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yes, submitted" }));
    expect(screen.getByText("Bid marked as submitted")).toBeInTheDocument();
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
