import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  analysisSkills,
  type ResumeSkillEntry,
} from './mappers/resume.mapper';

/**
 * Sync analyzed skills into account_info.resumeAnalysisCatalog[title]
 * for recommend-resume ranking (Athens-server parity).
 */
@Injectable()
export class ResumeCatalogSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async syncStack(profileId: string, title: string): Promise<void> {
    const stack = String(title ?? '').trim();
    if (!profileId || !stack) return;

    const analyzed = await this.prisma.resume.findMany({
      where: { profileId, title: stack, analyzed: true },
    });

    const skills = mergeSkillsFromResumes(analyzed.map(analysisSkills));

    const acc = await this.prisma.accountInfo.findUnique({
      where: { id: profileId },
    });
    if (!acc) return;

    const catalog =
      acc.resumeAnalysisCatalog &&
      typeof acc.resumeAnalysisCatalog === 'object' &&
      !Array.isArray(acc.resumeAnalysisCatalog)
        ? {
            ...(acc.resumeAnalysisCatalog as Record<string, unknown>),
          }
        : {};
    catalog[stack] = skills;

    await this.prisma.accountInfo.update({
      where: { id: profileId },
      data: {
        resumeAnalysisCatalog: catalog as Prisma.InputJsonValue,
        resumeAnalysisCatalogUpdatedAt: new Date(),
      },
    });
  }
}

function mergeSkillsFromResumes(
  profiles: ResumeSkillEntry[][],
): ResumeSkillEntry[] {
  const byKey = new Map<string, ResumeSkillEntry>();
  for (const list of profiles) {
    for (const raw of list) {
      const name = String(raw?.name ?? '').trim();
      if (!name) continue;
      const level = Number(raw.level);
      if (!Number.isFinite(level)) continue;
      const clamped = Math.max(1, Math.min(5, Math.round(level)));
      const category = String(raw.category ?? '').trim();
      const key = name.toLowerCase();
      const prev = byKey.get(key);
      if (!prev || clamped > prev.level) {
        byKey.set(key, { name, category, level: clamped });
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.level - a.level || a.name.localeCompare(b.name),
  );
}
