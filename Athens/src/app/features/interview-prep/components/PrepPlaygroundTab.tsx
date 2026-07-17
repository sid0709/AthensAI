import React, { useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { PromptEditor } from "./PromptEditor";
import { PlaygroundOutput } from "./PlaygroundOutput";
import {
  DEFAULT_SYSTEM_PROMPT,
  MOCK_OUTPUTS,
  buildSystemFromInterview,
} from "../../../data/interview/playground";
import type { CalendarEvent } from "../../../data/calendar";

type PrepPlaygroundTabProps = {
  selectedInterview: CalendarEvent | null;
  initialPrompt?: string;
};

export function PrepPlaygroundTab({ selectedInterview, initialPrompt }: PrepPlaygroundTabProps) {
  const [system, setSystem] = useState(DEFAULT_SYSTEM_PROMPT);
  const [user, setUser] = useState(initialPrompt || "Help me prepare for my upcoming interview. What should I focus on?");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);

  const initFromInterview = () => {
    if (!selectedInterview) return;
    setSystem(
      buildSystemFromInterview(
        selectedInterview.company ?? "Company",
        selectedInterview.title,
        new Date(selectedInterview.start).toLocaleString(),
      ),
    );
    setUser(`Prepare me for the ${selectedInterview.title} at ${selectedInterview.company}.`);
  };

  const run = () => {
    setRunning(true);
    setOutput("");
    const key = selectedInterview?.company?.toLowerCase().includes("notion") ? "notion" : "default";
    const text = MOCK_OUTPUTS[key] ?? MOCK_OUTPUTS.default;
    let i = 0;
    const interval = setInterval(() => {
      i += 12;
      setOutput(text.slice(0, i));
      if (i >= text.length) {
        clearInterval(interval);
        setRunning(false);
      }
    }, 30);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 p-5 gap-4 overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-shrink-0">
        <PromptEditor label="System" value={system} onChange={setSystem} rows={5} />
        <PromptEditor label="User" value={user} onChange={setUser} rows={5} />
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={run}
          disabled={running}
          className="flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10 disabled:opacity-60"
        >
          <Play className="w-4 h-4" />
          Run
        </button>
        <button
          type="button"
          onClick={initFromInterview}
          disabled={!selectedInterview}
          className="flex items-center gap-2 bg-secondary border border-border px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-muted min-h-10 disabled:opacity-50"
        >
          <RotateCcw className="w-4 h-4" />
          Initialize from interview
        </button>
      </div>
      <PlaygroundOutput output={output} running={running} />
    </div>
  );
}
