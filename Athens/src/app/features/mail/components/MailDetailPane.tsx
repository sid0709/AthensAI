import React from "react";
import { ArrowLeft, Send, Sparkles, Archive, Trash2, Loader2, Star } from "lucide-react";
import { Av } from "../../../components/ui";
import { cn } from "../../../lib/utils";
import { labelPillClass } from "../lib/mailLabelStyles";
import type { MailThread } from "../../../types";

type MailDetailPaneProps = {
  thread: MailThread | null;
  fullView?: boolean;
  loading?: boolean;
  /** Beta workspace — enables AI Reply */
  aiReplyEnabled?: boolean;
  onBack?: () => void;
  onArchive?: () => void;
  onTrash?: () => void;
  onReply?: () => void;
  onAiReply?: () => void;
};

export function MailDetailPane({
  thread,
  fullView = false,
  loading = false,
  aiReplyEnabled = false,
  onBack,
  onArchive,
  onTrash,
  onReply,
  onAiReply,
}: MailDetailPaneProps) {
  if (!thread) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a message to read
      </div>
    );
  }

  const actionsDisabled = loading || !thread;

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-background">
      {fullView && onBack && (
        <div className="px-4 py-3 border-b border-border flex-shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground min-h-10"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to inbox
          </button>
        </div>
      )}
      <div className="px-5 py-4 border-b border-border flex-shrink-0">
        <h2 className={fullView ? "text-xl font-bold text-foreground mb-3" : "text-base font-bold text-foreground mb-2"}>
          {thread.subj}
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <Av name={thread.from} size={fullView ? "md" : "sm"} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground">{thread.from}</p>
            {thread.fromEmail && (
              <p className="text-xs text-muted-foreground truncate">{thread.fromEmail}</p>
            )}
            <p className="text-xs text-muted-foreground">{thread.time}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {thread.starred && (
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" aria-label="Starred" />
            )}
            {thread.labels.map((l) => (
              <span
                key={l}
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${labelPillClass(l)}`}
              >
                {l}
              </span>
            ))}
            <button
              type="button"
              onClick={onArchive}
              disabled={actionsDisabled}
              className="icon-btn text-muted-foreground hover:text-foreground border border-border disabled:opacity-50"
            >
              <Archive className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onTrash}
              disabled={actionsDisabled}
              className="icon-btn text-muted-foreground hover:text-foreground border border-border disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      <div className={`flex-1 overflow-auto subtle-scroll ${fullView ? "px-8 py-6 max-w-3xl mx-auto w-full" : "p-5"}`}>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading message…
          </div>
        ) : thread.bodyHtml ? (
          <div
            key={`body-${thread.id}-${thread.hasBody ? "loaded" : "preview"}`}
            className={`mail-body-html max-w-none text-foreground/85 leading-relaxed ${fullView ? "text-base" : "text-sm"} [&_img]:max-w-full [&_img]:h-auto [&_img]:my-2 [&_a]:text-primary [&_a]:underline [&_table]:max-w-full`}
            dangerouslySetInnerHTML={{ __html: thread.bodyHtml }}
          />
        ) : (
          thread.body.split("\n").map((line, i) => (
            <p key={i} className={`text-foreground/85 leading-relaxed mb-3 last:mb-0 ${fullView ? "text-base" : "text-sm"}`}>
              {line || "\u00A0"}
            </p>
          ))
        )}
      </div>
      <div className={`border-t border-border p-4 flex-shrink-0 ${fullView ? "max-w-3xl mx-auto w-full" : ""}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onReply}
            disabled={actionsDisabled}
            className={cn(
              "flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10",
              "disabled:opacity-50 disabled:pointer-events-none",
            )}
          >
            <Send className="w-4 h-4" />
            Reply
          </button>
          {aiReplyEnabled && (
            <button
              type="button"
              onClick={onAiReply}
              disabled={actionsDisabled}
              className={cn(
                "flex items-center gap-2 bg-background border border-border px-4 py-2 rounded-xl text-sm font-bold min-h-10",
                "hover:bg-secondary text-foreground",
                "disabled:opacity-50 disabled:pointer-events-none",
              )}
            >
              <Sparkles className="w-4 h-4 text-primary" />
              AI Reply
            </button>
          )}
        </div>
        {aiReplyEnabled && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            AI Reply drafts a response from this email — pick an intent, edit, then send.
          </p>
        )}
      </div>
    </div>
  );
}
