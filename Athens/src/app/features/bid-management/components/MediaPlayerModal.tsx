import { useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { X, AlertCircle, Loader2 } from "lucide-react";

/**
 * YouTube-style player fed by a signed Firebase Storage URL.
 * Portaled to document.body so it sits above the Bid detail Sheet overlay
 * (Radix portals at z-50 and otherwise steals all pointer events).
 */
export function MediaPlayerModal({
  open,
  title,
  subtitle,
  src,
  loading = false,
  error = null,
  pathHint,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  src: string | null;
  loading?: boolean;
  error?: string | null;
  pathHint?: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.dataset.bmPlayerOpen = "1";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      delete document.body.dataset.bmPlayerOpen;
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="bm-player-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className="bm-player"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="bm-player-top">
              <div>
                <h2 className="bm-player-title">{title}</h2>
                {subtitle ? <p className="bm-player-sub">{subtitle}</p> : null}
              </div>
              <button
                type="button"
                className="bm-player-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bm-player-stage">
              {loading ? (
                <div className="bm-player-state">
                  <Loader2 className="w-7 h-7 animate-spin" />
                  <span>Signing stream…</span>
                </div>
              ) : error ? (
                <div className="bm-player-state">
                  <AlertCircle className="w-7 h-7" />
                  <span>{error}</span>
                </div>
              ) : src ? (
                <video
                  key={src}
                  className="bm-player-video"
                  src={src}
                  controls
                  controlsList="nodownload"
                  autoPlay
                  playsInline
                  preload="metadata"
                >
                  <track kind="captions" />
                </video>
              ) : (
                <div className="bm-player-state">
                  <AlertCircle className="w-7 h-7" />
                  <span>No preview available</span>
                </div>
              )}
            </div>

            {pathHint ? <div className="bm-player-path">{pathHint}</div> : null}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
