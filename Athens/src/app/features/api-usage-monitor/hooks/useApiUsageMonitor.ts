import { useCallback, useEffect, useState } from "react";
import {
  fetchAiUsageMonitor,
  type AiUsageMonitorApiKey,
  type AiUsageMonitorResponse,
  type AiUsageMonitorUser,
} from "../../../api/aiUsage";
import type { DateRange } from "../../../hooks/useAnalyticsFilters";
import { rangeToIsoDates } from "../../analytics/lib/dateRange";

const EMPTY_TOTALS: AiUsageMonitorResponse["totals"] = {
  calls: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  costUsd: 0,
  registeredUsers: 0,
  usersWithKeys: 0,
  usersWithUsage: 0,
  configuredKeys: 0,
};

export function useApiUsageMonitor(range: DateRange, requesterName?: string | null) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totals, setTotals] = useState(EMPTY_TOTALS);
  const [users, setUsers] = useState<AiUsageMonitorUser[]>([]);
  const [apiKeys, setApiKeys] = useState<AiUsageMonitorApiKey[]>([]);
  const [unassigned, setUnassigned] = useState<AiUsageMonitorResponse["unassigned"]>([]);

  const requester = String(requesterName || "").trim() || undefined;

  const load = useCallback(async () => {
    if (!requester) {
      setLoading(false);
      setError(null);
      setTotals(EMPTY_TOTALS);
      setUsers([]);
      setApiKeys([]);
      setUnassigned([]);
      return;
    }

    setLoading(true);
    setError(null);
    const { startDate, endDate } = rangeToIsoDates(range);
    try {
      const data = await fetchAiUsageMonitor({
        since: startDate,
        until: endDate,
        requesterName: requester,
      });
      setTotals(data.totals ?? EMPTY_TOTALS);
      setUsers(data.users ?? []);
      setApiKeys(data.apiKeys ?? []);
      setUnassigned(data.unassigned ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load API usage monitor");
      setTotals(EMPTY_TOTALS);
      setUsers([]);
      setApiKeys([]);
      setUnassigned([]);
    } finally {
      setLoading(false);
    }
  }, [range, requester]);

  useEffect(() => {
    void load();
  }, [load]);

  return { loading, error, totals, users, apiKeys, unassigned, refetch: load };
}
