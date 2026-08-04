import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { demoAuthStore } from "./authStore";

describe("demoAuthStore", () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it("persists and restores a session without retaining the password", async () => {
    const session = await demoAuthStore.signIn({
      email: "  alex.taylor@example.com ",
      password: "not-stored"
    });

    expect(session.email).toBe("alex.taylor@example.com");
    expect(session.displayName).toBe("Alex Taylor");
    expect(await demoAuthStore.restore()).toEqual(session);

    const persistedStorage = await fakeBrowser.storage.local.get();
    expect(JSON.stringify(persistedStorage)).not.toContain("not-stored");
    expect(JSON.stringify(persistedStorage)).not.toContain("password");
  });

  it("clears the session on sign out", async () => {
    await demoAuthStore.signIn({ email: "demo@example.com", password: "demo" });
    await demoAuthStore.signOut();

    expect(await demoAuthStore.restore()).toBeNull();
  });
});
