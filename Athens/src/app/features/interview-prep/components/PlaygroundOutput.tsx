import React from "react";
import { Loader2 } from "lucide-react";

type PlaygroundOutputProps = {
  output: string;
  running: boolean;
};

export function PlaygroundOutput({ output, running }: PlaygroundOutputProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0 border border-border rounded-xl overflow-hidden bg-card">
      <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Output</span>
        {running && (
          <span className="flex items-center gap-2 text-xs text-primary font-semibold">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Generating...
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto p-5 subtle-scroll">
        {output ? (
          <pre className="text-sm text-foreground/90 whitespace-pre-wrap font-sans leading-relaxed">{output}</pre>
        ) : (
          <p className="text-sm text-muted-foreground">Run a prompt to see AI-generated prep guidance.</p>
        )}
      </div>
    </div>
  );
}
