import { useEffect, useState } from "react";
import { fetchBidRecordingUrl } from "../../../api/bidResults";

/**
 * Resolve a bid-recording Storage path to a short-lived signed URL for playback.
 * Uses /bid-results/recording-url (profile-scoped) — not the admin Firebase explorer.
 */
export function useRecordingUrl(
  storagePath: string | null | undefined,
  applierName: string | null | undefined,
) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storagePath || !applierName?.trim()) {
      setUrl(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);

    void fetchBidRecordingUrl(applierName.trim(), storagePath)
      .then((res) => {
        if (!cancelled) setUrl(res.url);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to sign recording URL");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [storagePath, applierName]);

  return { url, loading, error };
}
