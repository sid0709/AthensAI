import React from "react";
import { Badge, Score } from "../../../components/ui";
import { Collapsible } from "../../../components/shared/Collapsible";
import { QUESTIONS, DIFFICULTY_VARIANTS, SCORECARDS } from "../../../data/interview";

type PrepQuestionBankTabProps = {
  onUseQuestion?: (question: string) => void;
};

export function PrepQuestionBankTab({ onUseQuestion }: PrepQuestionBankTabProps) {
  return (
    <div className="p-5 space-y-4 overflow-auto subtle-scroll">
      {QUESTIONS.map((q, i) => (
        <Collapsible
          key={i}
          title={
            <span className="flex items-center gap-2 flex-wrap">
              <Badge v="subtle">{q.cat}</Badge>
              <Badge v={DIFFICULTY_VARIANTS[q.diff]}>{q.diff}</Badge>
              <span className="text-sm font-semibold text-foreground line-clamp-1">{q.q}</span>
            </span>
          }
        >
          <p className="text-sm text-foreground/85 leading-relaxed mb-3">{q.q}</p>
          {onUseQuestion && (
            <button
              type="button"
              onClick={() => onUseQuestion(q.q)}
              className="text-xs font-bold text-primary hover:underline"
            >
              Use in playground →
            </button>
          )}
        </Collapsible>
      ))}
    </div>
  );
}

export function PrepScorecardsTab() {
  return (
    <div className="p-5 space-y-4 overflow-auto subtle-scroll">
      {SCORECARDS.map((c) => (
        <Collapsible
          key={c.company}
          title={
            <span className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                {c.company[0]}
              </span>
              <span className="text-sm font-bold text-foreground">{c.company} — {c.role}</span>
            </span>
          }
          defaultOpen={false}
        >
          <div className="flex items-center gap-4 mb-4">
            <Score score={c.overall} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {c.scores.map(([d, v]) => (
              <div key={d} className="text-center bg-secondary rounded-xl p-4">
                <div className="text-xl font-bold text-foreground">{v}</div>
                <div className="text-xs text-muted-foreground mt-1 font-semibold">{d}</div>
              </div>
            ))}
          </div>
        </Collapsible>
      ))}
    </div>
  );
}
