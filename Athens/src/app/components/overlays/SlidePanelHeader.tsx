import React from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

type SlidePanelHeaderProps = {
  title: string;
  onClose?: () => void;
  actions?: React.ReactNode;
  className?: string;
};

export function SlidePanelHeader({ title, onClose, actions, className }: SlidePanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-5 py-4 border-b border-border flex-shrink-0",
        className,
      )}
    >
      <h2 className="text-sm font-bold text-foreground truncate">{title}</h2>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="icon-btn text-muted-foreground hover:text-foreground w-9 h-9 min-w-9 min-h-9"
            aria-label="Close panel"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}
