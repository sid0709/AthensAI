import type { Job } from '@prisma/client';

type JobMetadata = {
  companyLogo?: string;
  companyTags?: string[];
  details?: Record<string, unknown>;
  legacyId?: string;
};

function asMetadata(raw: unknown): JobMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw;
}

/** Map Prisma Job → shape expected by Athens `mapDocToJob`. */
export function mapJobToListDoc(
  job: Job,
  viewerStatus = 'posted',
): Record<string, unknown> {
  const metadata = asMetadata(job.metadata);
  const tags = Array.isArray(metadata.companyTags)
    ? metadata.companyTags.map(String).filter(Boolean)
    : [];
  const logo =
    typeof metadata.companyLogo === 'string' ? metadata.companyLogo.trim() : '';

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
    description: job.description ?? undefined,
    aiSkills: job.aiSkills ?? undefined,
    aiSkillStatus: job.aiSkillStatus ?? undefined,
    details: metadata.details ?? undefined,
    catalog: job.sourceCatalog === 'external' ? 'external' : 'market',
    viewerStatus,
  };
}
