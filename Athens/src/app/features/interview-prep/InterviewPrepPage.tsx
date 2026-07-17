import React, { useMemo, useState } from "react";
import { Pill } from "../../components/ui";
import { TabTransition } from "../../components/overlays";
import { PrepContextSidebar } from "./components/PrepContextSidebar";
import { PrepPlaygroundTab } from "./components/PrepPlaygroundTab";
import { PrepQuestionBankTab, PrepScorecardsTab } from "./components/PrepSecondaryTabs";
import { CALENDAR_EVENTS, type CalendarEvent } from "../../data/calendar";

export function InterviewPrepPage() {
  const [tab, setTab] = useState("playground");
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [playgroundPrompt, setPlaygroundPrompt] = useState("");

  const upcoming = useMemo(() => {
    const now = new Date("2026-06-18T08:00:00");
    return CALENDAR_EVENTS.filter((e) => e.type === "interview" && new Date(e.start) >= now).sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
  }, []);

  return (
    <div className="h-full flex overflow-hidden">
      <PrepContextSidebar
        upcoming={upcoming}
        onSelectInterview={(e) => {
          setSelected(e);
          setTab("playground");
        }}
        selectedId={selected?.id}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-1 bg-secondary rounded-xl p-1 m-4 mb-0 w-fit flex-shrink-0">
          {["playground", "questions", "scorecards"].map((t) => (
            <Pill key={t} active={tab === t} onClick={() => setTab(t)}>
              {t}
            </Pill>
          ))}
        </div>
        <TabTransition tabKey={tab}>
          {tab === "playground" && (
            <PrepPlaygroundTab
              selectedInterview={selected ?? upcoming[0] ?? null}
              initialPrompt={playgroundPrompt}
            />
          )}
          {tab === "questions" && (
            <PrepQuestionBankTab
              onUseQuestion={(q) => {
                setPlaygroundPrompt(q);
                setTab("playground");
              }}
            />
          )}
          {tab === "scorecards" && <PrepScorecardsTab />}
        </TabTransition>
      </div>
    </div>
  );
}
