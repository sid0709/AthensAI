import React, { useState } from "react";
import { Inbox, Send, FileEdit, Trash2, AlertOctagon, Plus, Tag, MoreVertical } from "lucide-react";
import { cn } from "../../../lib/utils";
import { LABEL_DOT_CLASS, type MailFolderId } from "../../../data/mail";
import { buildLabelTree } from "../hooks/useMailLabels";
import { MailCreateLabelDialog } from "./MailCreateLabelDialog";
import { MailRemoveLabelDialog } from "./MailRemoveLabelDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import type { MailLabel } from "../../../types";
import type { FolderCounts } from "@/api/mail";
import { MAIL_LABEL_DRAG_MIME } from "../lib/mailDnD";

const FOLDER_ICONS: Record<MailFolderId, React.ElementType> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileEdit,
  trash: Trash2,
  spam: AlertOctagon,
};

const FOLDERS: { id: MailFolderId; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "drafts", label: "Drafts" },
  { id: "trash", label: "Trash" },
  { id: "spam", label: "Spam" },
];

type MailSidebarProps = {
  folder: MailFolderId;
  labelFilter: string | null;
  labels: MailLabel[];
  folderCounts?: FolderCounts;
  onFolderChange: (f: MailFolderId) => void;
  onLabelChange: (label: string | null) => void;
  onCreateLabel: (name: string, parentId?: string) => void;
  onRemoveLabel: (labelId: string) => Promise<boolean>;
  onCompose?: () => void;
};

export function MailSidebar({
  folder,
  labelFilter,
  labels,
  folderCounts,
  onFolderChange,
  onLabelChange,
  onCreateLabel,
  onRemoveLabel,
  onCompose,
}: MailSidebarProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<MailLabel | null>(null);
  const [removing, setRemoving] = useState(false);
  const tree = buildLabelTree(labels);

  const handleRemoveConfirm = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    const ok = await onRemoveLabel(removeTarget.id);
    setRemoving(false);
    if (ok) {
      if (labelFilter === removeTarget.name) onLabelChange(null);
      setRemoveTarget(null);
    }
  };

  return (
    <>
      <aside className="w-52 border-r border-border flex flex-col flex-shrink-0 bg-card/40 py-3">
        <div className="px-3 mb-3">
          <button
            type="button"
            onClick={onCompose}
            className="w-full flex items-center justify-center gap-2 bg-primary text-white px-3 py-2 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-9"
          >
            <Plus className="w-4 h-4" />
            Compose
          </button>
        </div>
        <nav className="px-2 space-y-0.5">
          {FOLDERS.map((f) => {
            const Icon = FOLDER_ICONS[f.id];
            const count = folderCounts?.[f.id]?.badge ?? 0;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  onFolderChange(f.id);
                  onLabelChange(null);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors min-h-9",
                  folder === f.id && !labelFilter
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left">{f.label}</span>
                {count > 0 && (
                  <span className="text-xs font-bold text-primary tabular-nums">{count}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="mt-4 px-3 flex-1 overflow-y-auto subtle-scroll">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5" />
            Labels
          </p>
          <div className="space-y-0.5">
            {tree.map(({ label: l, depth }) => {
              const labelPath = l.path || l.name;
              return (
              <div
                key={l.id}
                className="group/label relative flex items-center min-w-0"
                style={{ paddingLeft: `${12 + depth * 14}px` }}
              >
                <button
                  type="button"
                  draggable
                  title="Drag onto mail to apply label"
                  onDragStart={(e) => {
                    e.dataTransfer.setData(MAIL_LABEL_DRAG_MIME, labelPath);
                    e.dataTransfer.setData("text/plain", labelPath);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => onLabelChange(labelFilter === l.name ? null : l.name)}
                  className={cn(
                    "flex-1 flex items-center gap-2 py-1.5 pr-8 rounded-lg text-sm transition-colors min-w-0 cursor-grab active:cursor-grabbing",
                    labelFilter === l.name
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full flex-shrink-0",
                      LABEL_DOT_CLASS[l.color],
                    )}
                  />
                  <span className="truncate">{l.shortName || l.name}</span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="absolute right-0 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-0 group-hover/label:opacity-100 hover:bg-secondary text-muted-foreground hover:text-foreground"
                      aria-label={`Label options for ${l.name}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setRemoveTarget(l)}
                    >
                      Remove label
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
            })}
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            >
              <Plus className="w-3.5 h-3.5" />
              Add label
            </button>
          </div>
        </div>
      </aside>

      <MailCreateLabelDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        labels={labels}
        onCreate={onCreateLabel}
      />

      <MailRemoveLabelDialog
        label={removeTarget}
        open={Boolean(removeTarget)}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        onConfirm={() => void handleRemoveConfirm()}
        removing={removing}
      />
    </>
  );
}
