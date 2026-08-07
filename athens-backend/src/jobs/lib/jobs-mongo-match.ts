import type { ListJobsQueryDto } from '../dto/list-jobs.query.dto';

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSources(raw: string | undefined): string[] {
  const text = String(raw ?? '').trim();
  if (!text || text === 'all') return [];
  return [
    ...new Set(
      text
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

function parseDayStart(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const d = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDayEnd(isoDate: string): Date | null {
  const start = parseDayStart(isoDate);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Mongo $match for filtered company grouping (mirrors JobsQueryService.buildWhere). */
export function buildJobsMongoMatch(
  query: ListJobsQueryDto,
): Record<string, unknown> {
  const match: Record<string, unknown> = {
    companyId: { $exists: true, $ne: null },
  };

  const q = String(query.q ?? '').trim();
  if (q) {
    match.title = { $regex: escapeRegex(q), $options: 'i' };
  }

  const company = String(query.company ?? '').trim();
  if (company) {
    match.companyName = { $regex: escapeRegex(company), $options: 'i' };
  }

  const sources = parseSources(query.source);
  if (sources.length) {
    match.source = { $in: sources };
  }

  const from = query.postedFrom ? parseDayStart(query.postedFrom) : null;
  const to = query.postedTo ? parseDayEnd(query.postedTo) : null;
  if (from || to) {
    match.postedAt = {
      ...(from ? { $gte: from } : {}),
      ...(to ? { $lte: to } : {}),
    };
  }

  if (query.aiExtracted) {
    match.aiSkillStatus = 'extracted';
  }

  return match;
}

export { parseSources, parseDayStart, parseDayEnd };
