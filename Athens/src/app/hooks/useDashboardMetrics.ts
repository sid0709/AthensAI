import { useMemo } from "react";
import { CALENDAR_EVENTS } from "../data/calendar";
import { FUNNEL } from "../data/dashboard";
import { JOBS } from "../data/jobs";

export function useDashboardMetrics() {
  return useMemo(() => {
    const savedJobs = JOBS.filter((j) => j.status === "posted").length;
    const appliedJobs = JOBS.filter((j) => j.status === "applied").length;
    const interviews = CALENDAR_EVENTS.filter((e) => e.type === "interview");
    const applied = FUNNEL.find((f) => f.s === "Applied")?.n ?? 0;
    const responses = FUNNEL.find((f) => f.s === "Screening")?.n ?? 0;
    const offers = FUNNEL.find((f) => f.s === "Offer")?.n ?? 0;
    const responseRate = applied > 0 ? Math.round((responses / applied) * 100) : 0;

    return {
      activeApps: appliedJobs || applied,
      savedJobs,
      interviewsThisWeek: interviews.length,
      confirmedInterviews: interviews.filter((e) => e.confirmed).length,
      responseRate,
      offers,
      avgResponseDays: 4.2,
      activeAgents: 3,
      agentTasks: 12,
      interviewsToday: interviews.filter((e) => {
        const d = new Date(e.start);
        return d.getDate() === 18 && d.getMonth() === 5;
      }).length,
    };
  }, []);
}

export function useUpcomingInterviews(limit = 5) {
  return useMemo(() => {
    const now = new Date("2026-06-18T08:00:00");
    return CALENDAR_EVENTS.filter((e) => e.type === "interview" && new Date(e.start) >= now)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
      .slice(0, limit);
  }, [limit]);
}
