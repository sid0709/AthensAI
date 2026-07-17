import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Coins, Hash, Loader2, RefreshCw, Zap } from "lucide-react";
import { useApplier } from "@/context/applier-context";
import {
  fetchRegisteredAccounts,
  type RegisteredAccount,
} from "../../api/accountInfo";
import { PageShell } from "../../components/layout/PageShell";
import { AthensSelect } from "../../components/forms";
import { Badge, ChartTip, KPI } from "../../components/ui";
import { Button } from "../../components/ui/button";
import { DATE_RANGE_OPTIONS, type DateRange } from "../../hooks/useAnalyticsFilters";
import { rangeLabel } from "../analytics/lib/rangeFilter";
import { formatRunCost } from "../agents/lib/runUsage";
import { mono } from "../../lib/utils";
import { useAiUsageAnalytics } from "./hooks/useAiUsageAnalytics";

function providerLabel(provider: string): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "deepseek") return "DeepSeek";
  return provider;
}

const CHART_COLORS = ["#6c5ce7", "#2dd4bf", "#f59e0b", "#ec4899", "#3b82f6", "#14b8a6", "#f97316", "#8b5cf6"];

function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTimestamp(value?: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function ChartCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-card border border-border rounded-xl p-6 shadow-sm ${className ?? ""}`}>
      <h3 className="text-sm font-bold text-foreground mb-1">{title}</h3>
      {subtitle ? <p className="text-sm text-muted-foreground mb-5">{subtitle}</p> : <div className="mb-5" />}
      {children}
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function AiUsagePage() {
  const { applier, applierReady } = useApplier();
  const [range, setRange] = useState<DateRange>("30d");
  const [selectedUser, setSelectedUser] = useState("");
  const [accounts, setAccounts] = useState<RegisteredAccount[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setUsersLoading(true);
      setUsersError(null);
      try {
        const list = await fetchRegisteredAccounts();
        if (cancelled) return;
        setAccounts(list);

        const preferred = applier?.name?.trim() || "";
        setSelectedUser((prev) => {
          if (prev && list.some((a) => a.name === prev)) return prev;
          if (preferred && list.some((a) => a.name === preferred)) return preferred;
          return list[0]?.name ?? "";
        });
      } catch (e) {
        if (cancelled) return;
        setUsersError(e instanceof Error ? e.message : "Failed to load users");
        setAccounts([]);
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applier?.name]);

  const userOptions = useMemo(
    () =>
      accounts.map((a) => ({
        value: a.name,
        label: a.tier ? `${a.name} (${a.tier})` : a.name,
      })),
    [accounts],
  );

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.name === selectedUser) ?? null,
    [accounts, selectedUser],
  );

  const { loading, error, ready, totals, byDay, byFeature, byProvider, recentRows, refetch } =
    useAiUsageAnalytics(range, selectedUser || null, applier?.name);

  const selectedLabel = useMemo(() => {
    return userOptions.find((o) => o.value === selectedUser)?.label || selectedUser || "user";
  }, [userOptions, selectedUser]);

  const configuredKeys = selectedAccount?.keys.filter((k) => k.configured) ?? [];

  const avgCostPerCall = totals.calls > 0 ? totals.costUsd / totals.calls : 0;
  const costTrendData = byDay.map((row) => ({
    day: formatDayLabel(row._id),
    cost: Number(row.costUsd.toFixed(6)),
    calls: row.calls,
  }));
  const tokenTrendData = byDay.map((row) => ({
    day: formatDayLabel(row._id),
    input: row.inputTokens,
    cached: row.cachedInputTokens,
    output: row.outputTokens,
  }));
  const featureData = byFeature.slice(0, 10).map((row) => ({
    name: row._id || "unknown",
    cost: Number(row.costUsd.toFixed(6)),
    calls: row.calls,
  }));
  const modelData = byProvider.slice(0, 8).map((row, i) => ({
    name: `${row._id.provider}/${row._id.billedModel}`,
    value: Number(row.costUsd.toFixed(6)),
    color: CHART_COLORS[i % CHART_COLORS.length],
    calls: row.calls,
  }));

  return (
    <PageShell>
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div>
          <p className="text-sm text-muted-foreground">
            LLM API consumption from <code className="text-xs">llm_call_log</code>
            {!ready && !usersLoading ? " — select a user to scope usage" : ""}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Showing data for {rangeLabel(range)}
            {ready ? (
              <>
                {" "}
                · user <span className="font-semibold text-foreground">{selectedLabel}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <AthensSelect
            value={selectedUser}
            onChange={setSelectedUser}
            options={userOptions}
            placeholder={usersLoading || !applierReady ? "Loading users…" : "Select user…"}
            disabled={usersLoading || userOptions.length === 0}
            className="w-56"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={loading || !ready}
          >
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

      {ready ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3 mb-5 shadow-sm">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                API keys · {selectedUser}
              </p>
              {configuredKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground mt-1">No API keys configured for this user.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {configuredKeys.map((key) => (
                    <li key={key.provider} className="flex items-start gap-2 text-sm min-w-0">
                      <Badge v="subtle">{providerLabel(key.provider)}</Badge>
                      <code className="text-xs text-foreground break-all select-all" style={mono}>
                        {key.value}
                      </code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {(selectedAccount?.defaultProvider || selectedAccount?.defaultModel) && (
              <p className="text-xs text-muted-foreground">
                Default:{" "}
                <span className="font-semibold text-foreground">
                  {[selectedAccount.defaultProvider, selectedAccount.defaultModel]
                    .filter(Boolean)
                    .join(" / ")}
                </span>
              </p>
            )}
          </div>
        </div>
      ) : null}

      {usersError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 p-4 text-sm mb-5">
          {usersError}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-800 p-4 text-sm mb-5">
          {error}
        </div>
      ) : null}

      {(usersLoading || loading) && totals.calls === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {usersLoading ? "Loading users…" : "Loading AI usage…"}
        </div>
      ) : !ready ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          {userOptions.length === 0
            ? "No registered users found."
            : "Select a user to view AI usage."}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI
              label="Total cost"
              value={formatRunCost(totals.costUsd)}
              sub={`${totals.calls} API calls`}
              icon={Coins}
              accent="violet"
            />
            <KPI
              label="API calls"
              value={String(totals.calls)}
              sub="successful + failed"
              icon={Activity}
              accent="blue"
            />
            <KPI
              label="Total tokens"
              value={formatTokens(totals.totalTokens)}
              sub={`${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out`}
              icon={Hash}
              accent="teal"
            />
            <KPI
              label="Avg cost / call"
              value={formatRunCost(avgCostPerCall)}
              sub={totals.cachedInputTokens > 0 ? `${formatTokens(totals.cachedInputTokens)} cached input` : "per request"}
              icon={Zap}
              accent="amber"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ChartCard title="Cost over time" subtitle="Daily spend and call volume">
              {costTrendData.length === 0 ? (
                <EmptyChart message="No AI calls recorded in this period." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={costTrendData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="cost" tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="calls" orientation="right" tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTip />} />
                    <Area yAxisId="cost" type="monotone" dataKey="cost" name="Cost (USD)" fill="#6c5ce7" stroke="#6c5ce7" fillOpacity={0.2} />
                    <Line yAxisId="calls" type="monotone" dataKey="calls" name="Calls" stroke="#2dd4bf" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Token usage over time" subtitle="Input, cached input, and output tokens per day">
              {tokenTrendData.length === 0 ? (
                <EmptyChart message="No token usage in this period." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={tokenTrendData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
                    <XAxis dataKey="day" tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="input" name="Input" stackId="tokens" fill="#6c5ce7" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="cached" name="Cached input" stackId="tokens" fill="#2dd4bf" />
                    <Bar dataKey="output" name="Output" stackId="tokens" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ChartCard title="Cost by feature" subtitle="Top features by billed spend">
              {featureData.length === 0 ? (
                <EmptyChart message="No feature breakdown available." />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={featureData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fill: "#6b6b84", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="cost" name="Cost (USD)" fill="#6c5ce7" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Cost by model" subtitle="Spend split by provider and billed model">
              {modelData.length === 0 ? (
                <EmptyChart message="No model breakdown available." />
              ) : (
                <div className="flex items-center gap-6">
                  <ResponsiveContainer width="55%" height={240}>
                    <PieChart>
                      <Pie data={modelData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
                        {modelData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2 min-w-0 flex-1">
                    {modelData.map((d) => (
                      <div key={d.name} className="flex items-center gap-2 text-xs">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                        <span className="text-muted-foreground truncate" title={d.name}>
                          {d.name}
                        </span>
                        <span className="font-bold text-foreground ml-auto" style={mono}>
                          {formatRunCost(d.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </ChartCard>
          </div>

          <ChartCard title="Recent API calls" subtitle="Latest LLM requests in this period (up to 100)">
            {recentRows.length === 0 ? (
              <EmptyChart message="No recent calls in this period." />
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2 font-semibold">Time</th>
                      <th className="px-2 py-2 font-semibold">Feature</th>
                      <th className="px-2 py-2 font-semibold">Model</th>
                      <th className="px-2 py-2 font-semibold text-right">Tokens</th>
                      <th className="px-2 py-2 font-semibold text-right">Cost</th>
                      <th className="px-2 py-2 font-semibold text-right">Duration</th>
                      <th className="px-2 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRows.map((row) => (
                      <tr key={row.requestId} className="border-b border-border/60 hover:bg-muted/30">
                        <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
                          {formatTimestamp(
                            typeof row.createdAt === "string"
                              ? row.createdAt
                              : row.createdAt
                                ? String(row.createdAt)
                                : undefined,
                          )}
                        </td>
                        <td className="px-2 py-2 max-w-[160px] truncate" title={row.feature}>
                          {row.feature || "—"}
                        </td>
                        <td className="px-2 py-2 max-w-[140px]">
                          <div className="truncate" title={row.billedModel}>
                            {row.billedModel || "—"}
                          </div>
                          {row.modelMismatch ? (
                            <span className="text-[10px] text-amber-600 font-semibold">model mismatch</span>
                          ) : null}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums" style={mono}>
                          {formatTokens(row.inputTokens ?? 0)} / {formatTokens(row.outputTokens ?? 0)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold" style={mono}>
                          {formatRunCost(row.costUsd ?? 0)}
                        </td>
                        <td className="px-2 py-2 text-right text-muted-foreground tabular-nums">
                          {row.durationMs != null ? `${row.durationMs}ms` : "—"}
                        </td>
                        <td className="px-2 py-2">
                          {row.success === false ? (
                            <Badge v="err">Failed</Badge>
                          ) : (
                            <Badge v="success">OK</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        </div>
      )}
    </PageShell>
  );
}
