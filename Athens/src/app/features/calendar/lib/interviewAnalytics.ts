import type { CalendarEvent, InterviewResult, InterviewStep } from "../../../data/calendar";
import { STEP_LABEL } from "../../../data/calendar";

export type PipelineMetrics = {
  totalInterviews: number;
  completed: number;
  passRate: number;
  failRate: number;
  ghostRate: number;
  pendingCount: number;
  scheduledCount: number;
  offerRate: number;
  avgDaysPerStage: number;
  stageConversion: { step: InterviewStep; label: string; entered: number; passed: number; rate: number }[];
  funnel: { step: InterviewStep; label: string; count: number }[];
  byCompany: { company: string; total: number; passed: number; rate: number }[];
  byProfile: { profile: string; total: number; passed: number; rate: number }[];
  dropReasons: { reason: string; count: number }[];
  velocityDays: number | null;
};

const STAGE_ORDER: InterviewStep[] = ["intro", "phone", "assessment", "tech", "onsite", "final", "offer"];

function interviews(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((e) => e.type === "interview");
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

export function computePipelineMetrics(events: CalendarEvent[]): PipelineMetrics {
  const ints = interviews(events);
  const withResult = ints.filter((e) => e.result && e.result !== "pending" && e.result !== "scheduled");
  const passed = ints.filter((e) => e.result === "passed");
  const failed = ints.filter((e) => e.result === "failed");
  const ignored = ints.filter((e) => e.result === "ignored");
  const pending = ints.filter((e) => e.result === "pending");
  const scheduled = ints.filter((e) => e.result === "scheduled");
  const offers = ints.filter((e) => e.step === "offer");

  const completed = withResult.length;
  const passRate = completed > 0 ? passed.length / completed : 0;
  const failRate = completed > 0 ? failed.length / completed : 0;
  const ghostRate = completed > 0 ? ignored.length / completed : 0;
  const offerRate = ints.length > 0 ? offers.filter((e) => e.result === "passed" || e.result === "scheduled").length / ints.length : 0;

  // Stage conversion: of events at step X that have a terminal result, what % passed?
  const stageConversion = STAGE_ORDER.map((step) => {
    const atStep = ints.filter((e) => e.step === step);
    const decided = atStep.filter((e) => e.result === "passed" || e.result === "failed" || e.result === "ignored");
    const stepPassed = decided.filter((e) => e.result === "passed").length;
    return {
      step,
      label: STEP_LABEL[step],
      entered: atStep.length,
      passed: stepPassed,
      rate: decided.length > 0 ? stepPassed / decided.length : 0,
    };
  }).filter((s) => s.entered > 0);

  // Funnel: count per stage (pipeline volume)
  const funnel = STAGE_ORDER.map((step) => ({
    step,
    label: STEP_LABEL[step],
    count: ints.filter((e) => e.step === step).length,
  })).filter((f) => f.count > 0);

  // By company
  const companyMap = new Map<string, { total: number; passed: number }>();
  for (const e of ints) {
    if (!e.company) continue;
    const cur = companyMap.get(e.company) ?? { total: 0, passed: 0 };
    cur.total++;
    if (e.result === "passed") cur.passed++;
    companyMap.set(e.company, cur);
  }
  const byCompany = [...companyMap.entries()]
    .map(([company, { total, passed: p }]) => ({
      company,
      total,
      passed: p,
      rate: total > 0 ? p / total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // By profile
  const profileMap = new Map<string, { total: number; passed: number }>();
  for (const e of ints) {
    if (!e.profile) continue;
    const cur = profileMap.get(e.profile) ?? { total: 0, passed: 0 };
    cur.total++;
    if (e.result === "passed") cur.passed++;
    profileMap.set(e.profile, cur);
  }
  const byProfile = [...profileMap.entries()]
    .map(([profile, { total, passed: p }]) => ({
      profile,
      total,
      passed: p,
      rate: total > 0 ? p / total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Drop reasons
  const reasonMap = new Map<string, number>();
  for (const e of ints) {
    if ((e.result === "failed" || e.result === "ignored") && e.reason?.trim()) {
      reasonMap.set(e.reason, (reasonMap.get(e.reason) ?? 0) + 1);
    }
  }
  const dropReasons = [...reasonMap.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // Avg days between consecutive stages per company pipeline
  const stageGaps: number[] = [];
  const byCo = new Map<string, CalendarEvent[]>();
  for (const e of ints) {
    if (!e.company || !e.step) continue;
    const list = byCo.get(e.company) ?? [];
    list.push(e);
    byCo.set(e.company, list);
  }
  for (const list of byCo.values()) {
    const sorted = [...list].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    for (let i = 1; i < sorted.length; i++) {
      stageGaps.push(daysBetween(sorted[i - 1].start, sorted[i].start));
    }
  }
  const avgDaysPerStage = stageGaps.length > 0 ? stageGaps.reduce((a, b) => a + b, 0) / stageGaps.length : 0;

  // Velocity: first intro to first offer (or latest event) per company
  const velocities: number[] = [];
  for (const list of byCo.values()) {
    const intro = list.find((e) => e.step === "intro");
    const offer = list.find((e) => e.step === "offer");
    if (intro && offer) velocities.push(daysBetween(intro.start, offer.start));
  }
  const velocityDays = velocities.length > 0 ? velocities.reduce((a, b) => a + b, 0) / velocities.length : null;

  return {
    totalInterviews: ints.length,
    completed,
    passRate,
    failRate,
    ghostRate,
    pendingCount: pending.length,
    scheduledCount: scheduled.length,
    offerRate,
    avgDaysPerStage,
    stageConversion,
    funnel,
    byCompany,
    byProfile,
    dropReasons,
    velocityDays,
  };
}

export function resultBadge(result?: InterviewResult): string {
  if (!result) return "—";
  return { pending: "Pending", scheduled: "Scheduled", passed: "Passed", failed: "Failed", ignored: "Ignored" }[result];
}
