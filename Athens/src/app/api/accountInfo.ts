import { API_BASE } from "@/lib/api-base";

export type AccountApiKeyInfo = {
  provider: "openai" | "deepseek";
  configured: boolean;
  value: string | null;
};

export type RegisteredAccount = {
  _id?: unknown;
  name: string;
  tier?: string | null;
  defaultProvider?: string | null;
  defaultModel?: string | null;
  keys: AccountApiKeyInfo[];
};

function extractKeys(profile: Record<string, unknown> | undefined): AccountApiKeyInfo[] {
  const openai = String(profile?.openaiApiKey || "").trim();
  const deepseek = String(profile?.deepseekApiKey || "").trim();
  return [
    {
      provider: "openai",
      configured: Boolean(openai),
      value: openai || null,
    },
    {
      provider: "deepseek",
      configured: Boolean(deepseek),
      value: deepseek || null,
    },
  ];
}

/** List all registered accounts (passwords stripped by the server). */
export async function fetchRegisteredAccounts(): Promise<RegisteredAccount[]> {
  const res = await fetch(`${API_BASE.replace(/\/$/, "")}/account_info`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  const data = (await res.json()) as Array<Record<string, unknown>> | { message?: string };
  if (!Array.isArray(data)) {
    throw new Error("Unexpected account_info response");
  }
  return data
    .map((row) => {
      const name = String(row.name || "").trim();
      const profile =
        row.autoBidProfile && typeof row.autoBidProfile === "object"
          ? (row.autoBidProfile as Record<string, unknown>)
          : undefined;
      return {
        _id: row._id,
        name,
        tier: (row.tier as string | null | undefined) ?? null,
        defaultProvider: profile?.defaultProvider ? String(profile.defaultProvider) : null,
        defaultModel: profile?.defaultModel ? String(profile.defaultModel) : null,
        keys: extractKeys(profile),
      } satisfies RegisteredAccount;
    })
    .filter((row) => row.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}
