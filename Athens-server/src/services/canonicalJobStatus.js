const DATE_FIELDS = [
  'appliedDate',
  'scheduledDate',
  'declinedDate',
  'bidReadyDate',
  'bidCompletedDate',
];

function rawId(value) {
  if (value == null) return '';
  if (typeof value === 'object' && value && '$oid' in value) return String(value.$oid);
  return String(value).trim();
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : value && typeof value?.toDate === 'function'
      ? value.toDate()
      : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function earlier(left, right) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function later(left, right) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

export function createProfileIdResolver(accounts = []) {
  const ids = new Set();
  const names = new Map();
  for (const account of accounts) {
    const id = rawId(account?._id);
    if (!id) continue;
    ids.add(id);
    const name = String(account?.name || '').trim().toLowerCase();
    if (name) names.set(name, id);
  }
  return (value) => {
    const raw = rawId(value);
    if (ids.has(raw)) return raw;
    return names.get(raw.toLowerCase()) || null;
  };
}

/**
 * Normalize the authoritative embedded array. Invalid identities/dates are
 * reported and never silently discarded by the migration command.
 */
export function normalizeCanonicalJobStatuses(rows, resolveProfileId) {
  const issues = [];
  const grouped = new Map();
  for (const [index, raw] of (Array.isArray(rows) ? rows : []).entries()) {
    if (!raw || typeof raw !== 'object') {
      issues.push({ index, field: 'row', value: raw, reason: 'status row must be an object' });
      continue;
    }
    const profileId = resolveProfileId(raw.applier);
    if (!profileId) {
      issues.push({ index, field: 'applier', value: rawId(raw.applier), reason: 'unknown profile reference' });
      continue;
    }
    const parsed = { applier: profileId };
    for (const field of DATE_FIELDS) {
      if (!raw[field]) continue;
      const normalized = isoDate(raw[field]);
      if (!normalized) {
        issues.push({ index, field, value: String(raw[field]), reason: 'invalid timestamp' });
      } else {
        parsed[field] = normalized;
      }
    }
    const existing = grouped.get(profileId) || { applier: profileId };
    const mergedDates = {
      appliedDate: earlier(existing.appliedDate, parsed.appliedDate),
      bidReadyDate: earlier(existing.bidReadyDate, parsed.bidReadyDate),
      scheduledDate: later(existing.scheduledDate, parsed.scheduledDate),
      declinedDate: later(existing.declinedDate, parsed.declinedDate),
      bidCompletedDate: later(existing.bidCompletedDate, parsed.bidCompletedDate),
    };
    for (const [field, value] of Object.entries(mergedDates)) {
      if (value) existing[field] = value;
    }
    grouped.set(profileId, existing);
  }

  const statuses = [];
  for (const row of grouped.values()) {
    if (row.scheduledDate && row.declinedDate) {
      if (Date.parse(row.scheduledDate) >= Date.parse(row.declinedDate)) delete row.declinedDate;
      else delete row.scheduledDate;
    }
    if ((row.scheduledDate || row.declinedDate) && !row.appliedDate) {
      row.appliedDate = row.scheduledDate || row.declinedDate;
    }
    if (row.bidCompletedDate && !row.bidReadyDate) row.bidReadyDate = row.bidCompletedDate;
    if (DATE_FIELDS.some((field) => row[field])) statuses.push(row);
  }
  statuses.sort((left, right) => left.applier.localeCompare(right.applier));
  return { statuses, issues };
}
