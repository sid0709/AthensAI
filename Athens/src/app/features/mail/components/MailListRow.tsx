import React, { useState } from "react";
import { Archive, Star, Trash2, Mail } from "lucide-react";
import { cn } from "../../../lib/utils";
import { Checkbox } from "../../../components/ui/checkbox";
import { labelPillClass } from "../lib/mailLabelStyles";
import { getDraggedLabelPath, MAIL_LABEL_DRAG_MIME } from "../lib/mailDnD";
import type { MailThread } from "../../../types";

type MailListRowProps = {
  thread: MailThread;
  selected: boolean;
  onSelect: () => void;
  onToggleSelect?: (checked: boolean) => void;
  onStar?: () => void;
  onArchive?: () => void;
  onTrash?: () => void;
  onMarkUnread?: () => void;
  onDropLabel?: (labelPath: string) => void;
};

export function MailListRow({
  thread,
  selected,
  onSelect,
  onToggleSelect,
  onStar,
  onArchive,
  onTrash,
  onMarkUnread,
  onDropLabel,
}: MailListRowProps) {
  const starred = thread.starred ?? false;
  const senderName = thread.from.split("(")[0]?.trim() || thread.from;
  const [dragOver, setDragOver] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!onDropLabel) return;
    const types = Array.from(e.dataTransfer.types || []);
    if (!types.includes(MAIL_LABEL_DRAG_MIME) && !types.includes("text/plain")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!onDropLabel) return;
    e.preventDefault();
    setDragOver(false);
    const path = getDraggedLabelPath(e.dataTransfer);
    if (path) onDropLabel(path);
  };

  return (
    <div
      className={cn(
        "group relative flex items-center border-b border-border/30 min-h-[40px]",
        selected && "bg-primary/5",
        thread.unread && "bg-background",
        dragOver && "bg-primary/15 ring-1 ring-inset ring-primary/40",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {onToggleSelect && (
        <div
          className="pl-3 flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onToggleSelect(v === true)}
            aria-label={`Select ${thread.subj}`}
          />
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        className="flex flex-1 items-center gap-2.5 px-4 py-2 min-w-0 cursor-pointer hover:bg-secondary/40 transition-colors"
      >
        {thread.unread ? (
          <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
        ) : (
          <span className="w-2 flex-shrink-0" />
        )}

        {starred && (
          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 flex-shrink-0" aria-label="Starred" />
        )}

        <span
          className={cn(
            "text-sm w-[7.5rem] flex-shrink-0 truncate",
            thread.unread ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
          )}
        >
          {senderName}
        </span>

        <span className="text-sm flex-1 min-w-0 truncate">
          <span className={cn(thread.unread ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>
            {thread.subj}
          </span>
          {thread.prev && (
            <span className="text-muted-foreground font-normal"> — {thread.prev}</span>
          )}
        </span>

        <div className="flex items-center gap-1.5 flex-shrink-0 max-w-[40%] overflow-hidden">
          {thread.labels.slice(0, 3).map((l) => (
            <span
              key={l}
              className={cn(
                "text-[11px] font-medium px-2 py-0.5 rounded-full truncate max-w-[8rem]",
                labelPillClass(l),
              )}
            >
              {l}
            </span>
          ))}
        </div>

        <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0 tabular-nums min-w-[3.5rem] text-right pr-14">
          {thread.time}
        </span>
      </div>

      <div className="hidden group-hover:flex items-center gap-0.5 absolute right-3 top-1/2 -translate-y-1/2 bg-background/95 rounded-lg px-1 shadow-sm border border-border">
        <button
          type="button"
          className={cn(
            "icon-btn w-7 h-7",
            starred ? "text-amber-500" : "text-muted-foreground hover:text-amber-500",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onStar?.();
          }}
          aria-label={starred ? "Unstar" : "Star"}
        >
          <Star className={cn("w-3.5 h-3.5", starred && "fill-current")} />
        </button>
        <button
          type="button"
          className="icon-btn w-7 h-7 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onArchive?.();
          }}
          aria-label="Archive"
        >
          <Archive className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className="icon-btn w-7 h-7 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onTrash?.();
          }}
          aria-label="Trash"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className="icon-btn w-7 h-7 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onMarkUnread?.();
          }}
          aria-label="Mark unread"
        >
          <Mail className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
