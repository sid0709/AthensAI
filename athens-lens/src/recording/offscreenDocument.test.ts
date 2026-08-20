import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureOffscreenDocument } from "./offscreenDocument";

describe("ensureOffscreenDocument", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not create a second document when hasDocument is missing but a ping answers", async () => {
    const createDocument = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", {
      offscreen: {
        Reason: { USER_MEDIA: "USER_MEDIA" },
        createDocument,
      },
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
    });

    await ensureOffscreenDocument();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("creates the offscreen document when nothing answers", async () => {
    const createDocument = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", {
      offscreen: {
        Reason: { USER_MEDIA: "USER_MEDIA" },
        createDocument,
      },
      runtime: {
        sendMessage: vi.fn(async () => {
          throw new Error("Receiving end does not exist");
        }),
      },
    });

    await ensureOffscreenDocument();
    expect(createDocument).toHaveBeenCalledOnce();
  });
});
