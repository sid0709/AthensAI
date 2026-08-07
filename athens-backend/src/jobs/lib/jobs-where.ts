import { Prisma } from '@prisma/client';
import type { ListJobsQueryDto } from '../dto/list-jobs.query.dto';
import { parseDayEnd, parseDayStart, parseSources } from './jobs-mongo-match';

/** Prisma where for catalog job filters (mirrors Mongo match). */
export function buildJobsPrismaWhere(
  query: ListJobsQueryDto,
): Prisma.JobWhereInput {
  const where: Prisma.JobWhereInput = {};
  const q = String(query.q ?? '').trim();
  if (q) {
    where.title = { contains: q, mode: 'insensitive' };
  }

  const company = String(query.company ?? '').trim();
  if (company) {
    where.companyName = { contains: company, mode: 'insensitive' };
  }

  const sources = parseSources(query.source);
  if (sources.length) {
    where.source = { in: sources };
  }

  const from = query.postedFrom ? parseDayStart(query.postedFrom) : null;
  const to = query.postedTo ? parseDayEnd(query.postedTo) : null;
  if (from || to) {
    where.postedAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  if (query.aiExtracted) {
    where.aiSkillStatus = 'extracted';
  }

  return where;
}

export function isEmptyWhere(where: Prisma.JobWhereInput): boolean {
  return Object.keys(where).length === 0;
}
