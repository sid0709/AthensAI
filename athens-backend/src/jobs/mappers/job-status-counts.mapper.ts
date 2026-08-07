import type { JobStatusCounts } from '@prisma/client';
import {
  EMPTY_STATUS_COUNTS,
  type JobStatusTab,
} from '../constants/job-list.constants';

/** Map stored counter doc → Job Search badge shape. */
export function mapJobStatusCountsToTabs(
  row: JobStatusCounts | null | undefined,
  catalogTotal = 0,
): Record<JobStatusTab, number> {
  if (!row) {
    return { ...EMPTY_STATUS_COUNTS, all: catalogTotal };
  }
  return {
    all: catalogTotal,
    posted: row.posted,
    'bid-ready': row.bidReady,
    'bid-completed': row.bidCompleted,
    applied: row.applied,
    scheduled: row.scheduled,
    declined: row.declined,
  };
}
