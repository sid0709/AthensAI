import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JobStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /** States for one profile across a page of job ids. */
  async statesForJobs(
    profileId: string,
    jobIds: string[],
  ): Promise<Map<string, string>> {
    const id = String(profileId || '').trim();
    const ids = [
      ...new Set(jobIds.map((j) => String(j || '').trim()).filter(Boolean)),
    ];
    const out = new Map<string, string>();
    if (!id || !ids.length) return out;

    const rows = await this.prisma.jobStatus.findMany({
      where: { profileId: id, jobId: { in: ids } },
      select: { jobId: true, state: true },
    });
    for (const row of rows) out.set(row.jobId, row.state);
    return out;
  }
}
