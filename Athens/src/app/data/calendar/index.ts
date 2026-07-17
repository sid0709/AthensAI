export type CalendarEventType = "interview" | "deadline" | "followup";

export type InterviewStep =
  | "intro"
  | "phone"
  | "assessment"
  | "tech"
  | "onsite"
  | "final"
  | "offer";

export type InterviewResult = "pending" | "scheduled" | "passed" | "failed" | "ignored";

export const INTERVIEW_STEPS: { value: InterviewStep; label: string }[] = [
  { value: "intro", label: "Intro" },
  { value: "phone", label: "Phone Screen" },
  { value: "assessment", label: "Assessment" },
  { value: "tech", label: "Technical" },
  { value: "onsite", label: "Onsite" },
  { value: "final", label: "Final" },
  { value: "offer", label: "Offer" },
];

export const INTERVIEW_RESULTS: { value: InterviewResult; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "scheduled", label: "Scheduled" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "ignored", label: "Ignored" },
];

export const STEP_LABEL: Record<InterviewStep, string> = Object.fromEntries(
  INTERVIEW_STEPS.map((s) => [s.value, s.label]),
) as Record<InterviewStep, string>;

export const RESULT_LABEL: Record<InterviewResult, string> = Object.fromEntries(
  INTERVIEW_RESULTS.map((r) => [r.value, r.label]),
) as Record<InterviewResult, string>;

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  type: CalendarEventType;
  company?: string;
  confirmed?: boolean;
  /** Resume/profile used for this opportunity. */
  profile?: string;
  /** Interview pipeline stage. */
  step?: InterviewStep;
  /** Outcome once completed or closed. */
  result?: InterviewResult;
  /** Why it failed or was ignored. */
  reason?: string;
}

export const EVENT_COLORS: Record<CalendarEventType, string> = {
  interview: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-l-violet-500",
  deadline: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-l-blue-500",
  followup: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-l-amber-500",
};

export const RESULT_COLORS: Record<InterviewResult, string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  scheduled: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  passed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400",
  ignored: "bg-muted text-muted-foreground",
};

export const CALENDAR_EVENTS: CalendarEvent[] = [
  {
    id: "e1",
    title: "Notion PM Interview",
    start: "2026-06-19T14:00:00",
    end: "2026-06-19T15:00:00",
    type: "interview",
    company: "Notion",
    confirmed: true,
    profile: "Software Engineer — General",
    step: "final",
    result: "scheduled",
  },
  {
    id: "e2",
    title: "Stripe Assessment Due",
    start: "2026-06-20T23:59:00",
    end: "2026-06-20T23:59:00",
    type: "deadline",
    company: "Stripe",
    confirmed: true,
    profile: "Software Engineer — General",
  },
  {
    id: "e3",
    title: "Meta Offer Call",
    start: "2026-06-22T10:00:00",
    end: "2026-06-22T11:00:00",
    type: "interview",
    company: "Meta",
    confirmed: false,
    profile: "Software Engineer — General",
    step: "offer",
    result: "pending",
  },
  {
    id: "e4",
    title: "Follow-up: Linear",
    start: "2026-06-22T15:00:00",
    end: "2026-06-22T15:30:00",
    type: "followup",
    company: "Linear",
    confirmed: true,
    profile: "Frontend Specialist",
  },
  {
    id: "e5",
    title: "Anthropic Tech Interview",
    start: "2026-06-25T11:00:00",
    end: "2026-06-25T12:30:00",
    type: "interview",
    company: "Anthropic",
    confirmed: false,
    profile: "Software Engineer — General",
    step: "tech",
    result: "scheduled",
  },
  {
    id: "e6",
    title: "Job Scout Weekly Review",
    start: "2026-06-26T09:00:00",
    end: "2026-06-26T09:30:00",
    type: "followup",
    confirmed: true,
  },
  {
    id: "e7",
    title: "GitHub Phone Screen",
    start: "2026-06-30T13:00:00",
    end: "2026-06-30T13:45:00",
    type: "interview",
    company: "GitHub",
    confirmed: false,
    profile: "Full Stack — Startup",
    step: "phone",
    result: "pending",
  },
  {
    id: "e8",
    title: "Baseten Virtual Coding",
    start: "2026-06-18T10:00:00",
    end: "2026-06-18T11:00:00",
    type: "interview",
    company: "Baseten",
    confirmed: true,
    profile: "Software Engineer — General",
    step: "tech",
    result: "passed",
  },
  {
    id: "e9",
    title: "CVS Health Phone Screen",
    start: "2026-06-16T08:00:00",
    end: "2026-06-16T09:00:00",
    type: "interview",
    company: "CVS Health",
    confirmed: true,
    profile: "Software Engineer — General",
    step: "phone",
    result: "failed",
    reason: "Role filled internally before next round",
  },
  {
    id: "e10",
    title: "Glean Intro Call",
    start: "2026-06-17T12:00:00",
    end: "2026-06-17T12:30:00",
    type: "interview",
    company: "Glean",
    confirmed: true,
    profile: "Frontend Specialist",
    step: "intro",
    result: "passed",
  },
  {
    id: "e11",
    title: "Rippling Onsite",
    start: "2026-06-12T09:00:00",
    end: "2026-06-12T17:00:00",
    type: "interview",
    company: "Rippling",
    confirmed: true,
    profile: "Full Stack — Startup",
    step: "onsite",
    result: "failed",
    reason: "System design depth below bar",
  },
  {
    id: "e12",
    title: "Figma Recruiter Screen",
    start: "2026-06-10T14:00:00",
    end: "2026-06-10T14:30:00",
    type: "interview",
    company: "Figma",
    confirmed: true,
    profile: "Frontend Specialist",
    step: "intro",
    result: "ignored",
    reason: "No follow-up after 2 weeks",
  },
  {
    id: "e13",
    title: "Databricks Tech Round",
    start: "2026-06-08T11:00:00",
    end: "2026-06-08T12:00:00",
    type: "interview",
    company: "Databricks",
    confirmed: true,
    profile: "Software Engineer — General",
    step: "tech",
    result: "passed",
  },
  {
    id: "e14",
    title: "Snowflake Final",
    start: "2026-06-05T15:00:00",
    end: "2026-06-05T16:00:00",
    type: "interview",
    company: "Snowflake",
    confirmed: true,
    profile: "Software Engineer — General",
    step: "final",
    result: "passed",
  },
];

/** Legacy day-keyed map for month chips */
export function eventsByDay(
  month: number,
  year: number,
  source: CalendarEvent[] = CALENDAR_EVENTS,
): Record<number, CalendarEvent[]> {
  const map: Record<number, CalendarEvent[]> = {};
  source.forEach((e) => {
    const d = new Date(e.start);
    if (d.getMonth() === month && d.getFullYear() === year) {
      const day = d.getDate();
      if (!map[day]) map[day] = [];
      map[day].push(e);
    }
  });
  return map;
}

export function eventsInWeek(weekStart: Date, source: CalendarEvent[] = CALENDAR_EVENTS): CalendarEvent[] {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 7);
  return source.filter((e) => {
    const s = new Date(e.start);
    return s >= weekStart && s < end;
  });
}

export function formatTimeRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${fmt(start)}–${fmt(end)}`;
}

/** @deprecated use CALENDAR_EVENTS */
export const CAL_EVENTS: Record<number, { title: string; c: string }[]> = {};
