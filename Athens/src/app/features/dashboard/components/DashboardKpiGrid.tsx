import React from "react";
import {
  Briefcase,
  Video,
  UserCheck,
  FileText,
  Clock,
  Bot,
  Calendar,
  Sparkles,
} from "lucide-react";
import { KPI } from "../../../components/ui";
import { useDashboardMetrics } from "../../../hooks/useDashboardMetrics";

export function DashboardKpiGrid() {
  const m = useDashboardMetrics();

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Active Applications" value={String(m.activeApps)} trend="pipeline active" icon={Briefcase} accent="violet" />
        <KPI label="Interviews This Week" value={String(m.interviewsThisWeek)} sub={`${m.confirmedInterviews} confirmed`} icon={Video} accent="blue" />
        <KPI label="Response Rate" value={`${m.responseRate}%`} sub="from applications" icon={UserCheck} accent="emerald" />
        <KPI label="Jobs Saved" value={String(m.savedJobs)} sub="ready to apply" icon={FileText} accent="amber" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Offers Received" value={String(m.offers)} sub="in pipeline" icon={Sparkles} accent="pink" />
        <KPI label="Avg Response Time" value={`${m.avgResponseDays}d`} sub="↓1.3d improvement" icon={Clock} accent="teal" />
        <KPI label="Active Agents" value={String(m.activeAgents)} sub={`${m.agentTasks} tasks running`} icon={Bot} accent="violet" />
        <KPI label="Interviews Today" value={String(m.interviewsToday)} sub="on calendar" icon={Calendar} accent="rose" />
      </div>
    </>
  );
}
