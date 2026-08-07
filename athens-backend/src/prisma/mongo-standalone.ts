import type { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

/** Prisma Mongo transactional writes fail on standalone (non-replica-set) servers. */
export function isReplicaSetRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /replica set/i.test(message);
}

/** Extended JSON Date for Prisma `$runCommandRaw` (BSON Date, not ISO string). */
export function toMongoDate(
  value: Date | string | null | undefined,
): { $date: string } | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return { $date: d.toISOString() };
}

/**
 * Walk a raw Mongo document / $set payload and convert `Date` instances to
 * `{ $date: iso }` so `$runCommandRaw` stores BSON DateTime (Prisma-readable).
 */
export function toMongoJson(value: unknown): Prisma.InputJsonValue {
  if (value instanceof Date) {
    return { $date: value.toISOString() };
  }
  if (value === null || value === undefined) {
    return null as unknown as Prisma.InputJsonValue;
  }
  if (Array.isArray(value)) {
    return value.map((item) => toMongoJson(item)) as Prisma.InputJsonValue;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    // Already Extended JSON ($oid / $date / $numberLong) — leave alone.
    if ('$date' in obj || '$oid' in obj || '$numberLong' in obj) {
      return obj as Prisma.InputJsonValue;
    }
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      out[k] = toMongoJson(v);
    }
    return out;
  }
  return value as Prisma.InputJsonValue;
}

/** Delete matching docs via the Mongo wire protocol (no Prisma transaction). */
export async function rawDeleteMany(
  prisma: PrismaClient,
  collection: string,
  query: Prisma.InputJsonValue,
): Promise<number> {
  const result = await prisma.$runCommandRaw({
    delete: collection,
    deletes: [{ q: query, limit: 0 }],
  });
  return Number((result as { n?: number }).n ?? 0);
}

/** Insert one document via the Mongo wire protocol. */
export async function rawInsertOne(
  prisma: PrismaClient,
  collection: string,
  document: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.$runCommandRaw({
    insert: collection,
    documents: [toMongoJson(document)],
    ordered: true,
  });
}

/** Update matching docs via the Mongo wire protocol. */
export async function rawUpdateMany(
  prisma: PrismaClient,
  collection: string,
  query: Prisma.InputJsonValue,
  set: Prisma.InputJsonValue,
): Promise<number> {
  const result = await prisma.$runCommandRaw({
    update: collection,
    updates: [
      {
        q: query,
        u: { $set: toMongoJson(set) },
        multi: true,
      },
    ],
  });
  return Number((result as { n?: number }).n ?? 0);
}

/**
 * Convert string ISO timestamps → BSON Date for fields Prisma maps as DateTime.
 * Uses aggregation-pipeline update (`$toDate`). Safe to call repeatedly.
 */
export async function repairStringDateFields(
  prisma: PrismaClient,
  collection: string,
  fields: string[],
): Promise<void> {
  for (const field of fields) {
    await prisma.$runCommandRaw({
      update: collection,
      updates: [
        {
          q: { [field]: { $type: 'string' } },
          u: [{ $set: { [field]: { $toDate: `$${field}` } } }],
          multi: true,
        },
      ],
    });
  }
}

export function objectIdIn(ids: string[]): Prisma.InputJsonValue {
  return {
    $in: ids.map((id) => ({ $oid: id })),
  };
}

/** Prefer typed Prisma deleteMany; fall back to raw on standalone Mongo. */
export async function deleteManyWithFallback(
  prisma: PrismaClient,
  collection: string,
  rawQuery: Prisma.InputJsonValue,
  viaPrisma: () => Promise<{ count: number }>,
): Promise<number> {
  try {
    const result = await viaPrisma();
    return result.count;
  } catch (error) {
    if (!isReplicaSetRequired(error)) throw error;
    return rawDeleteMany(prisma, collection, rawQuery);
  }
}

/** Prefer typed Prisma write; fall back to raw on standalone Mongo. */
export async function withReplicaSetFallback<T>(
  viaPrisma: () => Promise<T>,
  viaRaw: () => Promise<T>,
): Promise<T> {
  try {
    return await viaPrisma();
  } catch (error) {
    if (!isReplicaSetRequired(error)) throw error;
    return viaRaw();
  }
}
