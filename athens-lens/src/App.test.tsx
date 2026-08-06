import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { mockInboxRepository } from "./inbox/inboxRepository";
import { MOCK_INBOX_MESSAGES, MOCK_UNREAD_COUNT } from "./inbox/mockInbox";
import { MOCK_JOBS } from "./jobs/mockJobs";
import { useRecordingSessionsStore } from "./recording/recordingSessionsStore";
import { useTabWorkspaceStore } from "./state/tabWorkspaceStore";
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

function installChromeStub(overrides?: {
  sendMessage?: (message: {
    type?: string;
    tabId?: number;
    preferredTabId?: number | null;
    streamId?: string;
    captureSource?: string;
    relayOffer?: RTCSessionDescriptionInit;
  }) => unknown | Promise<unknown>;
  activeTab?: { id: number; url?: string } | (() => { id: number; url?: string });
  createTabId?: number | (() => number);
  streamId?: string | null;
  captureError?: string;
}) {
  let createCalls = 0;
  const resolveActiveTab = () => {
    if (typeof overrides?.activeTab === "function") return overrides.activeTab();
    return overrides?.activeTab ?? { id: 42, url: "https://example.com/page" };
  };
  const resolveCreateTabId = () => {
    createCalls += 1;
    if (typeof overrides?.createTabId === "function") return overrides.createTabId();
    return overrides?.createTabId ?? 42;
  };

  const defaultSendMessage = async (message: {
    type?: string;
    tabId?: number;
    preferredTabId?: number | null;
  }) => {
    if (message?.type === "ATHENS_LENS_START_RECORDING") {
      return {
        ok: true,
        tabId: message.tabId ?? message.preferredTabId ?? 42,
        relayAnswer: { type: "answer", sdp: "mock-answer" },
      };
    }
    if (message?.type === "ATHENS_LENS_STOP_RECORDING") {
      return { ok: true, tabId: 42, filename: "athens-lens-recording-test.webm" };
    }
    if (message?.type === "ATHENS_LENS_LIST_SESSIONS") {
      return { ok: true, sessions: [] };
    }
    if (message?.type === "ATHENS_LENS_RECORDING_DIGEST") {
      return { ok: false, error: "No pending recording in tests." };
    }
    if (message?.type === "ATHENS_LENS_PUT_RECORDING") {
      return { ok: false, error: "No pending recording in tests." };
    }
    if (message?.type === "ATHENS_LENS_DISCARD_RECORDING") {
      return { ok: true };
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
  };

  const sendMessage = overrides?.sendMessage
    ? vi.fn(async (message: { type?: string; tabId?: number; preferredTabId?: number | null; streamId?: string }) => {
        const handled = await overrides.sendMessage!(message);
        if (handled !== undefined) return handled;
        return defaultSendMessage(message);
      })
    : vi.fn(defaultSendMessage);

  const chromeApi = {
    runtime: {
      sendMessage,
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      lastError: undefined as { message?: string } | undefined,
    },
    tabs: {
      query: vi.fn((_query: unknown, callback: (tabs: Array<{ id: number; url?: string }>) => void) => {
        callback([resolveActiveTab()]);
      }),
      create: vi.fn((
        createProperties: { url: string; active?: boolean },
        callback?: (tab: { id: number; url: string }) => void,
      ) => {
        callback?.({ id: resolveCreateTabId(), url: createProperties.url });
      }),
      remove: vi.fn(),
      onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabCapture: {
      getMediaStreamId: vi.fn((
        _options: { targetTabId: number },
        callback: (streamId: string) => void,
      ) => {
        if (overrides?.captureError || overrides?.streamId === null) {
          chromeApi.runtime.lastError = {
            message: overrides?.captureError || "Could not capture this tab. Focus a normal http(s) page and try Record again.",
          };
          callback("");
          chromeApi.runtime.lastError = undefined;
          return;
        }
        callback(overrides?.streamId ?? "mock-stream-id");
      }),
    },
    desktopCapture: {
      chooseDesktopMedia: vi.fn((
        _sources: Array<"screen" | "window" | "tab" | "audio">,
        callback: (streamId: string, options: { canRequestAudioTrack: boolean }) => void,
      ) => {
        if (overrides?.captureError || overrides?.streamId === null) {
          chromeApi.runtime.lastError = overrides?.captureError
            ? { message: overrides.captureError }
            : undefined;
          callback("", { canRequestAudioTrack: false });
          chromeApi.runtime.lastError = undefined;
          return 1;
        }
        callback(overrides?.streamId ?? "mock-stream-id", { canRequestAudioTrack: false });
        return 1;
      }),
      cancelChooseDesktopMedia: vi.fn(),
    },
  };

  vi.stubGlobal("chrome", chromeApi);
  return chromeApi;
}

function installMediaRelayStub() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream) },
  });

  class MockPeerConnection {
    iceGatheringState: RTCIceGatheringState = "complete";
    localDescription: RTCSessionDescription | null = null;

    addTrack() {}
    addEventListener() {}
    removeEventListener() {}
    close() {}
    async createOffer(): Promise<RTCSessionDescriptionInit> {
      return { type: "offer", sdp: "mock-offer" };
    }
    async setLocalDescription(description: RTCSessionDescriptionInit) {
      this.localDescription = description as RTCSessionDescription;
    }
    async setRemoteDescription() {}
  }

  vi.stubGlobal("RTCPeerConnection", MockPeerConnection);
}

describe("Athens Lens app", () => {
  beforeEach(async () => {
    await resetWorkspaceCacheForTests();
    useRecordingSessionsStore.getState().clearAll();
    useTabWorkspaceStore.getState().clearAll();
    window.location.hash = "#jobs";
    installMediaRelayStub();
    installChromeStub();
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
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();
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
    const user = userEvent.setup();
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

    await screen.findByRole("heading", { name: MOCK_JOBS[0].title });
    await user.click(screen.getByRole("button", { name: /Gmail inbox/ }));
    expect(await screen.findByRole("heading", { name: MOCK_INBOX_MESSAGES[0].subject })).toBeInTheDocument();
    expect(screen.getByText("Loading message…")).toBeInTheDocument();
    resolveSelectedBody?.([MOCK_INBOX_MESSAGES[0]]);
    expect(await screen.findByText(MOCK_INBOX_MESSAGES[0].body[0])).toBeInTheDocument();
    expect(inboxRepository.loadMessageBodies).toHaveBeenCalledWith(expect.anything(), [MOCK_INBOX_MESSAGES[0].id]);
  });

  it("starts, restarts, completes, and reviews a live bid recording", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/athens-lens/ask-ai")) {
        const sse = [
          "event: token",
          'data: {"text":"{\\"formAnswers\\":["}',
          "",
          "event: answers",
          'data: {"answers":[{"question":"Why are you interested in this role?","suggestedAnswer":"I am interested because the work matches my background.","confidence":"high"}]}',
          "",
          "event: done",
          'data: {"success":true,"mode":"llm-stream","summary":"Application form detected.","answers":[{"question":"Why are you interested in this role?","suggestedAnswer":"I am interested because the work matches my background.","confidence":"high"}]}',
          "",
        ].join("\n");
        return new Response(sse, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      if (url.includes("/athens-lens/bids/")) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: false, message: `Unhandled ${url}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <App
        authStore={makeAuthStore(makeSession())}
        jobsRepository={jobsRepository}
        inboxRepository={mockInboxRepository}
      />
    );

    await screen.findByRole("heading", { name: MOCK_JOBS[0].title });
    await user.click(screen.getByRole("button", { name: "Record" }));

    expect(screen.getByRole("complementary", { name: "Application recording" })).toBeInTheDocument();
    expect(screen.getByText("Live tab capture · 00:00")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restart" }));
    await user.click(screen.getAllByRole("button", { name: "Ask AI" })[0]!);
    expect(screen.getByRole("dialog", { name: "Form answers" })).toBeInTheDocument();
    expect(screen.getByLabelText("AI response")).toBeInTheDocument();
    expect(await screen.findByText(/\d+ answers ready to copy/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Focused tab innerText")).not.toBeInTheDocument();
    expect(screen.getByText("I am interested because the work matches my background.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close AI answers" }));

    await user.click(screen.getByRole("button", { name: /Gmail inbox/ }));
    expect(await screen.findByText(`Recording application (${MOCK_JOBS[0].company})`)).toBeInTheDocument();
    expect(screen.getByText(`Role · ${MOCK_JOBS[0].title}`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Complete Bid" }));
    expect(screen.getByRole("dialog", { name: "Did you submit this bid?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yes, submitted" }));
    expect(await screen.findByText("Bid marked as submitted")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/athens-lens/bids/"))).toBe(true);
  });

  it("tracks concurrent recordings on separate browser tabs", async () => {
    const user = userEvent.setup();
    let startCount = 0;
    let activeTabId = 42;
    const chromeApi = installChromeStub({
      activeTab: () => ({ id: activeTabId, url: `https://example.com/tab-${activeTabId}` }),
      sendMessage: async (message) => {
        if (message?.type === "ATHENS_LENS_START_RECORDING") {
          startCount += 1;
          return {
            ok: true,
            tabId: message.tabId ?? activeTabId,
            relayAnswer: { type: "answer", sdp: "mock-answer" },
          };
        }
        return undefined;
      },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/athens-lens/bids/")) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: false }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <App
        authStore={makeAuthStore(makeSession())}
        jobsRepository={jobsRepository}
        inboxRepository={mockInboxRepository}
      />
    );

    await screen.findByRole("heading", { name: MOCK_JOBS[0].title });
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(chromeApi.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: MOCK_JOBS[0].applyUrl, active: true }),
      expect.any(Function),
    );
    // Apply tab keeps this job's detail — not the default jobs list.
    expect(await screen.findByRole("heading", { name: MOCK_JOBS[0].title })).toBeInTheDocument();
    expect(useTabWorkspaceStore.getState().byTabId[42]?.route).toEqual({
      view: "jobs",
      itemId: MOCK_JOBS[0].id,
    });
    expect(screen.queryByRole("complementary", { name: "Application recording" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Record" }));
    expect(await screen.findByText(`Recording application (${MOCK_JOBS[0].company})`)).toBeInTheDocument();
    expect(chromeApi.desktopCapture.chooseDesktopMedia).toHaveBeenCalledWith(
      ["tab"],
      expect.any(Function),
    );
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ATHENS_LENS_START_RECORDING",
        tabId: 42,
        captureSource: "desktop-relay",
        relayOffer: { type: "offer", sdp: "mock-offer" },
      }),
    );

    // Switching to a browser tab with no bid restores the jobs list viewpoint.
    activeTabId = 99;
    useRecordingSessionsStore.getState().setFocusedTabId(99);
    expect(await screen.findByText(/1 bid is recording on another tab/)).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Application recording" })).not.toBeInTheDocument();

    activeTabId = 43;
    useRecordingSessionsStore.getState().setFocusedTabId(43);
    await user.click(screen.getByRole("button", { name: new RegExp(MOCK_JOBS[1].title) }));
    await user.click(screen.getByRole("button", { name: "Record" }));

    expect(await screen.findByText(`Recording application (${MOCK_JOBS[1].company})`)).toBeInTheDocument();
    expect(screen.getByText(/1 other tab also recording/)).toBeInTheDocument();
    expect(startCount).toBe(2);
    expect(useRecordingSessionsStore.getState().sessionsByTabId[42]?.job?.id).toBe(MOCK_JOBS[0].id);
    expect(useRecordingSessionsStore.getState().sessionsByTabId[43]?.job?.id).toBe(MOCK_JOBS[1].id);
  });

  it("shows the original résumé filename after an upload audit", async () => {
    const user = userEvent.setup();
    const listeners: Array<(message: unknown) => void> = [];
    const chromeApi = installChromeStub();
    chromeApi.runtime.onMessage.addListener = vi.fn((listener: (message: unknown) => void) => {
      listeners.push(listener);
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/athens-lens/bids/")) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: false }), { status: 404 });
    }));

    render(
      <App
        authStore={makeAuthStore(makeSession())}
        jobsRepository={jobsRepository}
        inboxRepository={mockInboxRepository}
      />
    );

    await screen.findByRole("heading", { name: MOCK_JOBS[0].title });
    await user.click(screen.getByRole("button", { name: "Record" }));
    expect(await screen.findByText("Waiting for résumé upload…")).toBeInTheDocument();

    for (const listener of listeners) {
      listener({
        type: "ATHENS_LENS_RESUME_AUDIT",
        tabId: 42,
        sessionId: useRecordingSessionsStore.getState().sessionsByTabId[42]?.sessionId,
        jobId: MOCK_JOBS[0].id,
        originalName: "Backend.pdf",
        cleanedName: "Alex Taylor.pdf",
        expectedName: "Alex Taylor.pdf",
        renamed: true,
      });
    }

    expect(await screen.findByLabelText("Uploaded résumé")).toHaveTextContent(
      "Résumé · Backend.pdf → Alex Taylor.pdf",
    );
  });

  it("shows an error toast when the tab picker is canceled", async () => {
    const user = userEvent.setup();
    const chromeApi = installChromeStub({
      activeTab: { id: 99, url: "https://example.com/apply" },
      streamId: null,
      captureError: "Tab selection was canceled.",
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    render(
      <App
        authStore={makeAuthStore(makeSession())}
        jobsRepository={jobsRepository}
        inboxRepository={mockInboxRepository}
      />
    );

    await screen.findByRole("heading", { name: MOCK_JOBS[0].title });
    await waitFor(() => {
      expect(useRecordingSessionsStore.getState().focusedTabId).toBe(99);
    });
    await user.click(screen.getByRole("button", { name: "Record" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Tab selection was canceled/,
    );
    expect(chromeApi.desktopCapture.chooseDesktopMedia).toHaveBeenCalledWith(
      ["tab"],
      expect.any(Function),
    );
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
