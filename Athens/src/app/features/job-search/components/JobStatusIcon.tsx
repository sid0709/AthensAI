import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Inbox,
  Layers,
  List,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { JobStatus } from "../../../types";
import type { JobStatusTab } from "../../../hooks/useJobSearchFilters";

const JOB_STATUS_ICONS: Record<JobStatusTab, LucideIcon> = {
  all: List,
  posted: Inbox,
  "bid-ready": ClipboardList,
  "worker-pool": Layers,
  "bid-completed": BadgeCheck,
  applied: CheckCircle2,
  scheduled: CalendarClock,
  declined: XCircle,
};

export function JobStatusIcon({
  status,
  size = 16,
}: {
  status: JobStatusTab | JobStatus;
  size?: number;
}) {
  const Icon = JOB_STATUS_ICONS[status];
  return <Icon size={size} aria-hidden="true" />;
}
