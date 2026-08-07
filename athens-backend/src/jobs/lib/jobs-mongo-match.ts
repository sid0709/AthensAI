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

export type JobsIdConstraint =
  | { includeIds: string[] }
  | { excludeIds: string[] }
  | null;

/** Mongo $match for filtered company grouping (mirrors JobsQueryService.buildWhere). */
export function buildJobsMongoMatch(
  query: ListJobsQueryDto,
  idConstraint: JobsIdConstraint = null,
): Record<string, unknown> {
  const match: Record<string, unknown> = {
    companyId: { $exists: true, $ne: null },
  };

  if (idConstraint && 'includeIds' in idConstraint) {
    match._id = {
      $in: idConstraint.includeIds.map((id) => ({ $oid: id })),
    };
  } else if (idConstraint && 'excludeIds' in idConstraint) {
    if (idConstraint.excludeIds.length) {
      match._id = {
        $nin: idConstraint.excludeIds.map((id) => ({ $oid: id })),
      };
    }
  }

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
