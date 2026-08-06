import { Injectable } from '@nestjs/common';
import { AccountInfo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Must match `@@map("account_info")` on AccountInfo in prisma/schema.prisma.
 * Used only for $runCommandRaw fallbacks on standalone Mongo.
 */
const ACCOUNT_INFO_COLLECTION = 'account_info';

/**
 * Persistence for AccountInfo via PrismaService.
 * Standalone Mongo cannot run Prisma transactional writes; create/update
 * fall back to $runCommandRaw here only (§5 raw-in-one-place).
 */
@Injectable()
export class AccountInfoRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByExactName(name: string): Promise<AccountInfo | null> {
    return this.prisma.accountInfo.findUnique({ where: { name } });
  }

  findByUsernameKey(usernameKey: string): Promise<AccountInfo | null> {
    return this.prisma.accountInfo.findFirst({ where: { usernameKey } });
  }

  listOrderedByName(): Promise<AccountInfo[]> {
    return this.prisma.accountInfo.findMany({ orderBy: { name: 'asc' } });
  }

  async create(data: {
    name: string;
    usernameKey: string;
    password: string;
  }): Promise<AccountInfo> {
    try {
      return await this.prisma.accountInfo.create({ data });
    } catch (error) {
      if (!isReplicaSetRequired(error)) throw error;
      await this.prisma.$runCommandRaw({
        insert: ACCOUNT_INFO_COLLECTION,
        documents: [data],
        ordered: true,
      });
      const created = await this.findByExactName(data.name);
      if (!created) throw new Error('Failed to load created account');
      return created;
    }
  }

  async updatePassword(id: string, password: string): Promise<void> {
    try {
      await this.prisma.accountInfo.update({
        where: { id },
        data: { password },
      });
    } catch (error) {
      if (!isReplicaSetRequired(error)) throw error;
      await this.prisma.$runCommandRaw({
        update: ACCOUNT_INFO_COLLECTION,
        updates: [
          {
            q: { _id: { $oid: id } },
            u: { $set: { password } },
            multi: false,
          },
        ],
      });
    }
  }
}

function isReplicaSetRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /replica set/i.test(message);
}
