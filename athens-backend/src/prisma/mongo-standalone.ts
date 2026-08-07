import type { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';

/** Prisma Mongo transactional writes fail on standalone (non-replica-set) servers. */
export function isReplicaSetRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /replica set/i.test(message);
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
    documents: [document],
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
        u: { $set: set },
        multi: true,
      },
    ],
  });
  return Number((result as { n?: number }).n ?? 0);
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
