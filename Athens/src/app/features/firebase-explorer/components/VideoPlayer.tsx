import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Loader2, Play, AlertCircle } from "lucide-react";
import { fetchFirebaseStorageUrl } from "../../../api/firebase";

export function isVideoFile(name: string, contentType: string | null): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith(".webm") || lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".m4v")) {
    return true;
  }
  if (!contentType) return false;
  return contentType.startsWith("video/");
}

export function VideoPlayerModal({
  open,
  file,
  onClose,
}: {
  open: boolean;
  file: { name: string; fullPath: string; size: number; contentType: string | null } | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !file) {
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);
    void fetchFirebaseStorageUrl(file.fullPath)
      .then((res) => {
        if (!cancelled) setUrl(res.url);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, file]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && file && (
        <motion.div
          className="fx-player-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="fx-player"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="fx-player-top">
              <div className="fx-player-titles">
                <h2 className="fx-player-title">{file.name}</h2>
                <p className="fx-player-sub">
                  {file.contentType || "video"} · {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <button type="button" className="fx-player-close" onClick={onClose} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="fx-player-stage">
              {loading && (
                <div className="fx-player-state">
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <span>Loading stream…</span>
                </div>
              )}
              {error && (
                <div className="fx-player-state error">
                  <AlertCircle className="w-7 h-7" />
                  <span>{error}</span>
                </div>
              )}
              {url && !loading && !error && (
                <video
                  key={url}
                  className="fx-player-video"
                  src={url}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                >
                  <track kind="captions" />
                </video>
              )}
            </div>

            <div className="fx-player-path">{file.fullPath}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function VideoFileCard({
  file,
  onPlay,
}: {
  file: { name: string; fullPath: string; size: number; contentType: string | null };
  onPlay: () => void;
}) {
  return (
    <button type="button" className="fx-storage-card video" onClick={onPlay}>
      <div className="fx-video-thumb">
        <div className="fx-video-play">
          <Play className="w-6 h-6" fill="currentColor" />
        </div>
        <span className="fx-video-badge">
          {file.name.toLowerCase().endsWith(".mp4") ? "MP4" : "WEBM"}
        </span>
      </div>
      <div className="fx-file-name">{file.name}</div>
      <div className="fx-file-meta">
        {file.contentType || "video"} · {(file.size / 1024).toFixed(1)} KB
      </div>
    </button>
  );
}
