import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Which jobs already have a generated résumé for this applier.
 * Library half of Athens-server `findAgentJobResumeStatuses`.
 * Full resume-generations fallback lands when resume-gen is ported.
 */
@Injectable()
export class AgentJobResumesService {
  constructor(private readonly prisma: PrismaService) {}

  async status(applierName: string, jobIdsRaw: string[]) {
    const name = String(applierName || '').trim();
    const jobIds = [
      ...new Set(
        (Array.isArray(jobIdsRaw) ? jobIdsRaw : [])
          .map((id) => String(id || '').trim())
          .filter(Boolean),
      ),
    ].slice(0, 500);

    if (!name || !jobIds.length) {
      return { success: true as const, jobIds: [] as string[] };
    }

    const resumes = await this.prisma.resume.findMany({
      where: { ownerName: name, source: 'generated' },
      select: { generationId: true, analysis: true },
      take: 2000,
    });

    const wanted = new Set(jobIds);
    const found = new Set<string>();
    for (const row of resumes) {
      if (row.generationId && wanted.has(row.generationId)) {
        found.add(row.generationId);
      }
      const parent = parentJobIdFromAnalysis(row.analysis);
      if (parent && wanted.has(parent)) found.add(parent);
    }

    return { success: true as const, jobIds: [...found] };
  }
}

function parentJobIdFromAnalysis(analysis: unknown): string | null {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    return null;
  }
  const row = analysis as Record<string, unknown>;
  for (const key of [
    'generateParentJobId',
    'generate_parent_job_id',
    'parentJobId',
  ]) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}
