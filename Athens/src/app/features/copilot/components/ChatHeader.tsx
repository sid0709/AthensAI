import React from "react";
import { Wand2, Share2, Archive } from "lucide-react";

export function ChatHeader() {
  return (
    <div className="px-6 py-4 border-b border-border flex items-center gap-4 flex-shrink-0 bg-card/50">
      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
        <Wand2 className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold text-foreground">Career Copilot</p>
        <p className="text-xs text-emerald-600 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" />
          Online · Claude 3.5 + GPT-4o
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground font-semibold min-h-10">
          <Share2 className="w-4 h-4" />
          Share
        </button>
        <button type="button" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground font-semibold min-h-10">
          <Archive className="w-4 h-4" />
          Archive
        </button>
      </div>
    </div>
  );
}
