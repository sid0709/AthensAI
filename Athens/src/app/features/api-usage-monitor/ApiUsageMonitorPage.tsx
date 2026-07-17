import React, { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Coins,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  Users,
  Zap,
} from "lucide-react";
import { PageShell } from "../../components/layout/PageShell";
import { AthensSelect } from "../../components/forms";
import { Badge, KPI } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { DATE_RANGE_OPTIONS, type DateRange } from "../../hooks/useAnalyticsFilters";
import { rangeLabel } from "../analytics/lib/rangeFilter";
import { formatRunCost } from "../agents/lib/runUsage";
import { mono } from "../../lib/utils";
import type { AiUsageMonitorUser } from "../../api/aiUsage";
import { useApplier } from "@/context/applier-context";
import { useApiUsageMonitor } from "./hooks/useApiUsageMonitor";

function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatTimestamp(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function providerLabel(provider: string): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "deepseek") return "DeepSeek";
  return provider;
}

function UserDetail({ user }: { user: AiUsageMonitorUser }) {
  const configuredKeys = user.keys.filter((k) => k.configured);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-3 pb-4 pt-1">
      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">
          Configured API keys
        </h4>
        {configuredKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys configured.</p>
        ) : (
          <ul className="space-y-2">
            {configuredKeys.map((k) => {
              const providerSpend = user.usage.byProvider
                .filter((p) => p.provider === k.provider)
                .reduce(
                  (acc, p) => ({
                    calls: acc.calls + p.calls,
                    costUsd: acc.costUsd + p.costUsd,
                    totalTokens: acc.totalTokens + p.totalTokens,
                  }),
                  { calls: 0, costUsd: 0, totalTokens: 0 },
                );
              return (
                <li
                  key={k.provider}
                  className="flex items-start justify-between gap-3 text-sm border-b border-border/50 last:border-0 pb-2 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground">{providerLabel(k.provider)}</div>
                    <code className="text-xs text-muted-foreground break-all" style={mono}>
                      {k.masked}
                    </code>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold tabular-nums" style={mono}>
                      {formatRunCost(providerSpend.costUsd)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {providerSpend.calls} calls · {formatTokens(providerSpend.totalTokens)} tok
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {(user.defaultProvider || user.defaultModel) && (
          <p className="text-xs text-muted-foreground mt-3">
            Default: {[user.defaultProvider, user.defaultModel].filter(Boolean).join(" / ") || "—"}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-3">
          Usage by model
        </h4>
        {user.usage.byProvider.length === 0 ? (
          <p className="text-sm text-muted-foreground">No LLM calls in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-semibold">Provider / model</th>
                  <th className="pb-2 font-semibold text-right">Calls</th>
                  <th className="pb-2 font-semibold text-right">Tokens</th>
                  <th className="pb-2 font-semibold text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {user.usage.byProvider.map((row) => (
                  <tr key={`${row.provider}/${row.billedModel}`} className="border-t border-border/50">
                    <td className="py-1.5 pr-2 max-w-[200px] truncate" title={`${row.provider}/${row.billedModel}`}>
                      {row.provider}/{row.billedModel}
                    </td>
                    <td className="py-1.5 text-right tabular-nums" style={mono}>
                      {row.calls}
                    </td>
                    <td className="py-1.5 text-right tabular-nums" style={mono}>
                      {formatTokens(row.totalTokens)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-semibold" style={mono}>
                      {formatRunCost(row.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {user.usage.byFeature.length > 0 ? (
          <div className="mt-4">
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Top features
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {user.usage.byFeature.slice(0, 8).map((f) => (
                <span
                  key={f.feature}
                  className="inline-flex items-center gap-1.5 rounded-md bg-background border border-border px-2 py-1 text-xs"
                  title={`${f.calls} calls · ${formatTokens(f.totalTokens)} tokens`}
                >
                  <span className="text-muted-foreground truncate max-w-[120px]">{f.feature}</span>
                  <span className="font-semibold tabular-nums" style={mono}>
                    {formatRunCost(f.costUsd)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ApiUsageMonitorPage() {
  const { applier } = useApplier();
  const [range, setRange] = useState<DateRange>("30d");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { loading, error, totals, users, apiKeys, unassigned, refetch } = useApiUsageMonitor(
    range,
    applier?.name,
  );

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const hay = [u.name, u.fullName, u.email, u.tier, ...u.keys.map((k) => k.masked)]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [users, query]);

  const toggle = (name: string) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <PageShell>
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <p className="text-sm text-muted-foreground">
            All registered users, configured API keys, and LLM spend from{" "}
            <code className="text-xs">llm_call_log</code>
          </p>
          <p className="text-xs text-muted-foreground mt-1">Showing data for {rangeLabel(range)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </Button>
          <AthensSelect
            value={range}
            onChange={(v) => setRange(v as DateRange)}
            options={DATE_RANGE_OPTIONS}
            className="w-44"
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 p-4 text-sm mb-5">
          {error}
        </div>
      ) : null}

      {loading && totals.registeredUsers === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Loading API usage monitor…
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI
              label="Total spend"
              value={formatRunCost(totals.costUsd)}
              sub={`${totals.calls} API calls`}
              icon={Coins}
              accent="violet"
            />
            <KPI
              label="Registered users"
              value={String(totals.registeredUsers)}
              sub={`${totals.usersWithUsage} with usage`}
              icon={Users}
              accent="blue"
            />
            <KPI
              label="API keys"
              value={String(totals.configuredKeys)}
              sub={`${totals.usersWithKeys} users have keys`}
              icon={KeyRound}
              accent="amber"
            />
            <KPI
              label="Total tokens"
              value={formatTokens(totals.totalTokens)}
              sub={`${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out`}
              icon={Zap}
              accent="teal"
            />
          </div>

          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border flex-wrap">
              <div>
                <h3 className="text-sm font-bold text-foreground">Users & money usage</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Expand a row for key details and model breakdown
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search users…"
                  className="w-full h-9 rounded-lg border border-border bg-secondary/60 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                />
              </div>
            </div>

            {filteredUsers.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {users.length === 0 ? "No registered users found." : "No users match your search."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
                      <th className="px-3 py-2.5 font-semibold w-8" />
                      <th className="px-3 py-2.5 font-semibold">User</th>
                      <th className="px-3 py-2.5 font-semibold">API keys</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Calls</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Tokens</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Spend</th>
                      <th className="px-3 py-2.5 font-semibold">Last call</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => {
                      const open = Boolean(expanded[user.name]);
                      const keySummary = user.keys
                        .filter((k) => k.configured)
                        .map((k) => `${providerLabel(k.provider)} ${k.masked}`)
                        .join(" · ");
                      return (
                        <React.Fragment key={user.name}>
                          <tr
                            className="border-b border-border/60 hover:bg-muted/30 cursor-pointer"
                            onClick={() => toggle(user.name)}
                          >
                            <td className="px-3 py-2.5 text-muted-foreground">
                              {open ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="font-semibold text-foreground">{user.name}</div>
                              <div className="text-xs text-muted-foreground truncate max-w-[220px]">
                                {[user.fullName, user.email].filter(Boolean).join(" · ") || "—"}
                              </div>
                              {user.tier ? (
                                <div className="mt-1">
                                  <Badge v="violet">{user.tier}</Badge>
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5">
                              {keySummary ? (
                                <code className="text-xs text-muted-foreground break-all" style={mono}>
                                  {keySummary}
                                </code>
                              ) : (
                                <span className="text-xs text-muted-foreground">None</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={mono}>
                              {user.usage.calls}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums" style={mono}>
                              {formatTokens(user.usage.totalTokens)}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={mono}>
                              {formatRunCost(user.usage.costUsd)}
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                              {formatTimestamp(user.usage.lastCallAt)}
                            </td>
                          </tr>
                          {open ? (
                            <tr className="border-b border-border bg-muted/10">
                              <td colSpan={7}>
                                <UserDetail user={user} />
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="text-sm font-bold text-foreground">Used API keys</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Unique configured keys with spend attributed by provider for linked users
              </p>
            </div>
            {apiKeys.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No API keys configured on any account.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
                      <th className="px-4 py-2.5 font-semibold">Provider</th>
                      <th className="px-4 py-2.5 font-semibold">Key</th>
                      <th className="px-4 py-2.5 font-semibold">Users</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Calls</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Tokens</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys.map((key) => (
                      <tr
                        key={`${key.provider}:${key.fingerprint}`}
                        className="border-b border-border/60 hover:bg-muted/30"
                      >
                        <td className="px-4 py-2.5 font-medium">{providerLabel(key.provider)}</td>
                        <td className="px-4 py-2.5">
                          <code className="text-xs" style={mono}>
                            {key.masked}
                          </code>
                        </td>
                        <td className="px-4 py-2.5 max-w-[280px]">
                          <span className="text-muted-foreground text-xs" title={key.users.join(", ")}>
                            {key.users.join(", ")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums" style={mono}>
                          {key.calls}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums" style={mono}>
                          {formatTokens(key.totalTokens)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold" style={mono}>
                          {formatRunCost(key.costUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {unassigned.length > 0 ? (
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h3 className="text-sm font-bold text-foreground">Unassigned usage</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Calls whose applier name is missing or not in registered accounts
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
                      <th className="px-4 py-2.5 font-semibold">Applier</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Calls</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Tokens</th>
                      <th className="px-4 py-2.5 font-semibold text-right">Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unassigned.map((row) => (
                      <tr key={row.name} className="border-b border-border/60">
                        <td className="px-4 py-2.5">{row.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums" style={mono}>
                          {row.usage.calls}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums" style={mono}>
                          {formatTokens(row.usage.totalTokens)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold" style={mono}>
                          {formatRunCost(row.usage.costUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </PageShell>
  );
}
