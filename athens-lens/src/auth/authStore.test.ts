import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { athensAuthStore } from "./authStore";
import type { Session } from "../types";

const SESSION: Session = {
  username: "Alex Taylor",
  displayName: "Alex Taylor",
  profileId: "profile-1",
  authenticatedAt: "2026-08-04T12:00:00.000Z",
  expiresAt: "2099-08-04T12:00:00.000Z",
  accessToken: "secret-session-token"
};

describe("athensAuthStore", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.unstubAllGlobals();
  });

  it("signs in through Athens-server and persists no password", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ success: true, session: SESSION }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = await athensAuthStore.signIn({
      username: "  Alex Taylor ",
      password: "not-stored"
    });

    expect(session).toEqual(SESSION);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(request?.body))).toEqual({
      username: "Alex Taylor",
      password: "not-stored"
    });
    expect(await athensAuthStore.restore()).toEqual(SESSION);

    const persistedStorage = await fakeBrowser.storage.local.get();
    expect(JSON.stringify(persistedStorage)).not.toContain("not-stored");
    expect(JSON.stringify(persistedStorage)).not.toContain('"password"');
  });

  it("revokes the server session and clears local state on sign out", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }));
    await fakeBrowser.storage.local.set({ "athens-lens:session": SESSION });

    await athensAuthStore.signOut();

    expect(await athensAuthStore.restore()).toBeNull();
  });

  it("discards an expired stored session", async () => {
    await fakeBrowser.storage.local.set({
      "athens-lens:session": { ...SESSION, expiresAt: "2020-01-01T00:00:00.000Z" }
    });

    expect(await athensAuthStore.restore()).toBeNull();
  });
});
