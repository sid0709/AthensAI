import React from "react";
import { Wand2 } from "lucide-react";
import { cn, mono } from "../../../lib/utils";
import { renderBoldMarkdown } from "../../../lib/renderBoldMarkdown";
import type { Msg } from "../../../types";

type MessageListProps = {
  msgs: Msg[];
  typing: boolean;
  endRef: React.RefObject<HTMLDivElement | null>;
};

export function MessageList({ msgs, typing, endRef }: MessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5 subtle-scroll">
      {msgs.map((m) => (
        <div key={m.id} className={cn("flex gap-4", m.role === "user" ? "flex-row-reverse" : "")}>
          {m.role === "ai" ? (
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Wand2 className="w-5 h-5 text-primary" />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0 text-white text-sm font-bold">
              JD
            </div>
          )}
          <div className="max-w-[560px] min-w-0">
            <div
              className={cn(
                "rounded-xl px-5 py-4 text-sm leading-relaxed",
                m.role === "ai"
                  ? "bg-card border border-border text-foreground/85 shadow-sm"
                  : "bg-primary text-white shadow-sm"
              )}
            >
              {renderBoldMarkdown(m.content)}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 px-1" style={mono}>{m.ts}</p>
          </div>
        </div>
      ))}
      {typing && (
        <div className="flex gap-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Wand2 className="w-5 h-5 text-primary" />
          </div>
          <div className="bg-card border border-border rounded-xl px-5 py-4 shadow-sm">
            <div className="flex gap-1.5 items-center h-5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
