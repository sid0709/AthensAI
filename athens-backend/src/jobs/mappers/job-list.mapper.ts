import type { Job } from '@prisma/client';
import type { JobListRow } from '../constants/job-list.select';

type JobMetadata = {
  companyLogo?: string;
  companyTags?: string[];
  details?: Record<string, unknown>;
  legacyId?: string;
};

type JobListSource = JobListRow | Job;

function asMetadata(raw: unknown): JobMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

/** Map Prisma Job (list or detail) → shape expected by Athens `mapDocToJob`. */
export function mapJobToListDoc(
  job: JobListSource,
  viewerStatus = 'posted',
): Record<string, unknown> {
  const metadata = asMetadata(job.metadata);
  const tags = Array.isArray(metadata.companyTags)
    ? metadata.companyTags.map(String).filter(Boolean)
    : [];
  const logo =
    typeof metadata.companyLogo === 'string' ? metadata.companyLogo.trim() : '';
  const description =
    'description' in job && typeof job.description === 'string'
      ? job.description
      : undefined;

  return {
    _id: job.id,
    title: job.title,
    companyName: job.companyName,
    company: {
      name: job.companyName,
      ...(logo ? { logo } : {}),
      ...(tags.length ? { tags } : {}),
    },
    source: job.source,
    postedAt: job.postedAt.toISOString(),
    applyLink: job.applyLink ?? undefined,
    companyLink: job.companyLink ?? undefined,
    ...(description ? { description } : {}),
    aiSkills: job.aiSkills ?? undefined,
    aiSkillStatus: job.aiSkillStatus ?? undefined,
    details: metadata.details ?? undefined,
    catalog: job.sourceCatalog === 'external' ? 'external' : 'market',
    viewerStatus,
  };
}
