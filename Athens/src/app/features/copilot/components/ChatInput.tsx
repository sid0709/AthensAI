import React from "react";
import { Send, Paperclip } from "lucide-react";
import { AthensTextarea } from "../../../components/forms";
import { COPILOT_CHIPS } from "../../../data/copilot";

type ChatInputProps = {
  input: string;
  typing: boolean;
  onChange: (v: string) => void;
  onSend: () => void;
};

export function ChatInput({ input, typing, onChange, onSend }: ChatInputProps) {
  return (
    <>
      <div className="px-6 py-3 scroll-row flex-shrink-0 border-t border-border/50">
        {COPILOT_CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className="text-sm font-semibold px-4 py-2 bg-secondary border border-border rounded-full text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors min-h-10"
          >
            {c}
          </button>
        ))}
      </div>
      <div className="p-5 border-t border-border flex-shrink-0">
        <div className="flex items-end gap-3 bg-secondary border border-border rounded-xl px-5 py-3 focus-within:border-primary/40 transition-colors">
          <AthensTextarea
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder="Ask Copilot about your job search..."
            autoResize
            rows={1}
            className="flex-1 border-0 bg-transparent px-0 py-0 min-h-[24px] max-h-32 shadow-none focus-visible:border-0"
          />
          <div className="flex items-center gap-2 flex-shrink-0">
            <button type="button" className="icon-btn text-muted-foreground hover:text-foreground w-10 h-10">
              <Paperclip className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={onSend}
              disabled={!input.trim() || typing}
              className="icon-btn bg-primary text-white hover:bg-primary/90 disabled:opacity-30 shadow-sm"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Copilot can make mistakes. Verify important details before applying or sending messages.
        </p>
      </div>
    </>
  );
}
