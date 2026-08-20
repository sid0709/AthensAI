import {
  mongoFieldIdIn,
  mongoFieldIdNin,
  toMongoDate,
} from '../../prisma/mongo-standalone';
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
  { includeIds: string[] } | { excludeIds: string[] } | null;

/** Mongo $match for filtered company grouping and status-tab counts. */
export function buildJobsMongoMatch(
  query: ListJobsQueryDto,
  idConstraint: JobsIdConstraint = null,
): Record<string, unknown> {
  const match: Record<string, unknown> = {
    companyId: { $exists: true, $ne: null },
  };

  if (idConstraint && 'includeIds' in idConstraint) {
    Object.assign(match, mongoFieldIdIn('_id', idConstraint.includeIds));
  } else if (
    idConstraint &&
    'excludeIds' in idConstraint &&
    idConstraint.excludeIds.length
  ) {
    Object.assign(match, mongoFieldIdNin('_id', idConstraint.excludeIds));
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

  // $runCommandRaw requires Extended JSON dates ({ $date }), not JS Date /
  // ISO strings — otherwise BSON Date postedAt never matches the range.
  const from = query.postedFrom
    ? toMongoDate(parseDayStart(query.postedFrom))
    : null;
  const to = query.postedTo ? toMongoDate(parseDayEnd(query.postedTo)) : null;
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

/** Source, posted date, title/company text, or AI-extracted flag. */
export function hasAttributeFilters(query: ListJobsQueryDto): boolean {
  return (
    parseSources(query.source).length > 0 ||
    Boolean(String(query.q ?? '').trim()) ||
    Boolean(String(query.company ?? '').trim()) ||
    Boolean(String(query.postedFrom ?? '').trim()) ||
    Boolean(String(query.postedTo ?? '').trim()) ||
    Boolean(query.aiExtracted)
  );
}

/** Source filter only — no title/company text, dates, or AI-extracted flag. */
export function isSourceOnlyAttributeQuery(query: ListJobsQueryDto): boolean {
  return (
    parseSources(query.source).length > 0 &&
    !String(query.q ?? '').trim() &&
    !String(query.company ?? '').trim() &&
    !String(query.postedFrom ?? '').trim() &&
    !String(query.postedTo ?? '').trim() &&
    !query.aiExtracted
  );
}

export function canListBySourceBuckets(
  query: ListJobsQueryDto,
  idConstraint: JobsIdConstraint,
): boolean {
  return isSourceOnlyAttributeQuery(query) && idConstraint == null;
}

export { parseSources, parseDayStart, parseDayEnd };
