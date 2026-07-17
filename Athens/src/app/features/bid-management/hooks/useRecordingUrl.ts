import { useEffect, useState } from "react";
import { fetchFirebaseStorageUrl } from "../../../api/firebase";

/**
 * Resolve a Firebase Storage path to a short-lived signed URL for video playback.
 */
export function useRecordingUrl(storagePath: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storagePath) {
      setUrl(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);

    void fetchFirebaseStorageUrl(storagePath)
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
  }, [storagePath]);

  return { url, loading, error };
}
