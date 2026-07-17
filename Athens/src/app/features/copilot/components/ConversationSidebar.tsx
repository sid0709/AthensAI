import React from "react";
import { Plus } from "lucide-react";
import { cn } from "../../../lib/utils";

type ConversationSidebarProps = {
  conversations: string[];
  activeConv: number;
  onSelect: (index: number) => void;
  onNewChat: () => void;
};

export function ConversationSidebar({ conversations, activeConv, onSelect, onNewChat }: ConversationSidebarProps) {
  return (
    <div className="w-52 border-r border-border flex flex-col flex-shrink-0 bg-secondary/30">
      <div className="p-4 border-b border-border">
        <button
          type="button"
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors min-h-10"
        >
          <Plus className="w-4 h-4" />
          New chat
        </button>
      </div>
      <div className="flex-1 p-3 space-y-1 overflow-y-auto subtle-scroll">
        {conversations.map((c, i) => (
          <button
            key={`${c}-${i}`}
            type="button"
            onClick={() => onSelect(i)}
            className={cn(
              "w-full text-left px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors truncate min-h-10",
              activeConv === i ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary",
            )}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
