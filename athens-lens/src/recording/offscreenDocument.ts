type OffscreenApi = {
  hasDocument?: () => Promise<boolean>;
  createDocument(parameters: {
    url: string;
    reasons: chrome.offscreen.Reason[];
    justification: string;
  }): Promise<void>;
};

function offscreenApi(): OffscreenApi | null {
  return chrome.offscreen ?? null;
}

export async function ensureOffscreenDocument(): Promise<void> {
  const api = offscreenApi();
  if (!api?.createDocument) {
    throw new Error("The offscreen recorder is not available in this browser.");
  }

  if (typeof api.hasDocument === "function") {
    if (await api.hasDocument()) return;
  } else {
    try {
      const ping = await chrome.runtime.sendMessage({ type: "OFFSCREEN_PING" }) as { ok?: boolean } | undefined;
      if (ping?.ok) return;
    } catch {
      // No offscreen listener yet.
    }
  }

  try {
    await api.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen?.Reason?.USER_MEDIA ?? "USER_MEDIA" as chrome.offscreen.Reason],
      justification: "Record the application tab while bidding from Athens Lens.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/single offscreen document|already exists/i.test(message)) return;
    throw error;
  }
}

export async function tryOffscreenMessage(
  message: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const response = await chrome.runtime.sendMessage(message) as Record<string, unknown> | undefined;
    return response ?? null;
  } catch {
    return null;
  }
}
