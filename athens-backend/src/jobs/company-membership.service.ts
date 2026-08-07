import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeCompanyKey } from './lib/company-key';

export type CompanyProfileInput = {
  companyName: string;
  companyUrl?: string | null;
  companyLogo?: string | null;
};

export type CompanyMembershipInput = CompanyProfileInput & {
  jobId: string;
  postedAt: Date;
};

function asOptionalUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Prefer existing non-empty value; fill from incoming only when existing is missing.
 * Never replace a known companyUrl/companyLogo with null/empty.
 */
export function preferExistingText(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  return asOptionalUrl(existing) ?? asOptionalUrl(incoming);
}

/**
 * Upserts Company rows for Job Search grouping.
 *
 * Merge policy for companyUrl / companyLogo:
 * - existing missing + incoming present → fill
 * - existing present + incoming missing → keep existing
 * - both present → keep existing (do not overwrite)
 */
@Injectable()
export class CompanyMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create company if missing, or fill null URL/logo from temp job.
   * Does not touch jobIds — call {@link attachJob} after the Job row exists.
   */
  async upsertProfile(input: CompanyProfileInput): Promise<string> {
    const companyKey = normalizeCompanyKey(input.companyName);
    if (!companyKey) {
      throw new Error('companyName is required for company membership');
    }

    const displayName = String(input.companyName || '').trim() || companyKey;
    const incomingUrl = asOptionalUrl(input.companyUrl);
    const incomingLogo = asOptionalUrl(input.companyLogo);

    const existing = await this.prisma.company.findUnique({
      where: { companyKey },
    });

    if (!existing) {
      const created = await this.prisma.company.create({
        data: {
          companyKey,
          companyName: displayName,
          companyUrl: incomingUrl,
          companyLogo: incomingLogo,
          jobIds: [],
          lastPostedAt: new Date(0),
          jobCount: 0,
        },
      });
      return created.id;
    }

    const companyUrl = preferExistingText(existing.companyUrl, incomingUrl);
    const companyLogo = preferExistingText(existing.companyLogo, incomingLogo);
    const companyName = existing.companyName?.trim() || displayName;

    const urlChanged = companyUrl !== asOptionalUrl(existing.companyUrl);
    const logoChanged = companyLogo !== asOptionalUrl(existing.companyLogo);
    const nameChanged = companyName !== existing.companyName;

    if (urlChanged || logoChanged || nameChanged) {
      await this.prisma.company.update({
        where: { id: existing.id },
        data: { companyUrl, companyLogo, companyName },
      });
    }

    return existing.id;
  }

  /** Prepend job id (newest-first) after the Job catalog row is created. */
  async attachJob(input: {
    companyId: string;
    jobId: string;
    postedAt: Date;
  }): Promise<void> {
    const existing = await this.prisma.company.findUnique({
      where: { id: input.companyId },
    });
    if (!existing) {
      throw new Error(`company not found: ${input.companyId}`);
    }

    const jobIds = [
      input.jobId,
      ...existing.jobIds.filter((id) => id !== input.jobId),
    ];
    const lastPostedAt =
      input.postedAt > existing.lastPostedAt
        ? input.postedAt
        : existing.lastPostedAt;

    await this.prisma.company.update({
      where: { id: existing.id },
      data: {
        jobIds,
        jobCount: jobIds.length,
        lastPostedAt,
      },
    });
  }

  /** Upsert profile then attach job id (used by register / promote). */
  async ensureMembership(input: CompanyMembershipInput): Promise<string> {
    const companyId = await this.upsertProfile(input);
    await this.attachJob({
      companyId,
      jobId: input.jobId,
      postedAt: input.postedAt,
    });
    return companyId;
  }
}
