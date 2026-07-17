import { useMemo } from "react";
import { CALENDAR_EVENTS } from "../data/calendar";
import { JOBS } from "../data/jobs";
import { APPLICATIONS, FUNNEL } from "../data/applications";

export function useDashboardMetrics() {
  return useMemo(() => {
    const activeApps = APPLICATIONS.filter((a) => a.stage !== "Hired").length;
    const savedJobs = JOBS.filter((j) => j.status === "posted").length;
    const appliedJobs = JOBS.filter((j) => j.status === "applied").length;
    const interviews = CALENDAR_EVENTS.filter((e) => e.type === "interview");
    const offers = APPLICATIONS.filter((a) => a.stage === "Offer").length;
    const responses = FUNNEL.find((f) => f.stage === "Screening")?.count ?? 0;
    const applied = FUNNEL.find((f) => f.stage === "Applied")?.count ?? 0;
    const responseRate = applied > 0 ? Math.round((responses / applied) * 100) : 0;

    return {
      activeApps,
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
