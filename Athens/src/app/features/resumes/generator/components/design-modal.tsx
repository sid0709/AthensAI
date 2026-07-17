import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function DesignModal({
  open,
  title,
  icon: Icon,
  onClose,
  children,
  wide,
}: {
  open: boolean;
  title: string;
  icon: LucideIcon;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm grid place-items-center p-4 sm:p-6 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className={`bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-white/10 w-full ${
          wide ? "max-w-4xl" : "max-w-2xl"
        } max-h-[min(88vh,900px)] flex flex-col overflow-hidden shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-neutral-200 dark:border-white/10 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 grid place-items-center shrink-0">
              <Icon className="w-4 h-4 text-sky-500" />
            </div>
            <h2 className="text-sm font-semibold tracking-tight truncate">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 grid place-items-center rounded-xl border border-neutral-200 dark:border-white/10 hover:bg-neutral-100 dark:hover:bg-white/5 shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 md:p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
