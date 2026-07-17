import React from "react";
import { Sparkles, Mail, Video, Send } from "lucide-react";
import { display } from "../../../lib/utils";

type DashboardHeroProps = {
  onNavigate?: (view: string) => void;
};

export function DashboardHero({ onNavigate }: DashboardHeroProps) {
  const today = new Date(2026, 5, 18);
  const greeting = today.getHours() < 12 ? "Good morning" : today.getHours() < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="bg-gradient-to-br from-primary/10 via-card to-violet-500/5 border border-border rounded-2xl p-6 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground font-semibold">{today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
          <h2 className="text-2xl font-bold text-foreground mt-1" style={display}>
            {greeting}, Jordan
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Your AI career command center — 2 interviews today, 13 active applications.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => onNavigate?.("job-board")} className="flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10">
            <Send className="w-4 h-4" />
            Apply
          </button>
          <button type="button" onClick={() => onNavigate?.("interviews")} className="flex items-center gap-2 bg-secondary border border-border px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-muted min-h-10">
            <Video className="w-4 h-4" />
            Prep
          </button>
          <button type="button" onClick={() => onNavigate?.("mail")} className="flex items-center gap-2 bg-secondary border border-border px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-muted min-h-10">
            <Mail className="w-4 h-4" />
            Mail
          </button>
          <button type="button" onClick={() => onNavigate?.("copilot")} className="flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 text-violet-700 dark:text-violet-300 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-violet-500/15 min-h-10">
            <Sparkles className="w-4 h-4" />
            Copilot
          </button>
        </div>
      </div>
    </div>
  );
}
