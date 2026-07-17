import { useCallback, useState } from "react";
import { fetchAvalonHealth } from "../../../services/agentApi";
import type { AvalonHealthData } from "../../../types/agent";

export function useAvalonHealth() {
  const [health, setHealth] = useState<AvalonHealthData | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (sessionId?: string) => {
    setLoading(true);
    try {
      setHealth(await fetchAvalonHealth(sessionId));
    } catch {
      setHealth({ ok: false, extension: false });
    } finally {
      setLoading(false);
    }
  }, []);

  return { health, loading, refresh };
}
