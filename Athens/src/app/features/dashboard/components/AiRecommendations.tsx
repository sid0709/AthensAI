import React from "react";
import { Sparkles } from "lucide-react";
import { cn } from "../../../lib/utils";
import { AI_RECS } from "../../../data/dashboard";
import { useResumeNavigationOptional } from "../../../context/ResumeNavigationContext";

export function AiRecommendations() {
  const resumeNav = useResumeNavigationOptional();

  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-5">
        <h3 className="text-sm font-bold text-foreground flex-1">AI Recommendations</h3>
        <Sparkles className="w-5 h-5 text-violet-600" />
      </div>
      <div className="space-y-3">
        {AI_RECS.map((r, i) => (
          <div
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (r.a.toLowerCase().includes("tailor resume")) {
                resumeNav?.openEditor({
                  jd: "Senior Frontend Engineer at Vercel\nLocation: Remote\nRequired skills: React, TypeScript, Performance\nCompensation: $160k–$200k",
                  tab: "editor",
                });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && r.a.toLowerCase().includes("tailor resume")) {
                resumeNav?.openEditor({ tab: "editor" });
              }
            }}
            className="border border-border rounded-xl p-4 hover:shadow-sm transition-all cursor-pointer group"
          >
            <p className="text-sm text-foreground/75 leading-relaxed mb-2">{r.t}</p>
            <span className={cn("text-sm font-bold group-hover:underline", r.c)}>{r.a}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
