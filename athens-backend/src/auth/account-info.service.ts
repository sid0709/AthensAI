import { Inject, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Collection, Db, ObjectId, type Document, type WithId } from 'mongodb';
import { MONGO_DB } from '../mongo/mongo.module';

const BCRYPT_ROUNDS = 10;
const LEGACY_DEFAULT_PASSWORD = '12345678';
const COLLECTION = 'account_info';

export type AuthUserView = {
  _id: string;
  name: string;
  tier: string | null;
  permission: string | null;
};

@Injectable()
export class AccountInfoService {
  private readonly collection: Collection<Document>;

  constructor(@Inject(MONGO_DB) db: Db) {
    this.collection = db.collection(COLLECTION);
  }

  usernameKey(name: string): string {
    return name.trim().toLocaleLowerCase('en-US');
  }

  /** Exact name first (signin contract), then usernameKey fallback. */
  async findByName(
    name: string,
    { exactFirst = false } = {},
  ): Promise<WithId<Document> | null> {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return null;

    const exact = await this.collection.findOne({ name: trimmed });
    if (exact || exactFirst) return exact;

    return this.collection.findOne({ usernameKey: this.usernameKey(trimmed) });
  }

  async list(): Promise<WithId<Document>[]> {
    return this.collection.find({}).sort({ name: 1 }).toArray();
  }

  async create(data: {
    name: string;
    usernameKey: string;
    password: string;
  }): Promise<WithId<Document>> {
    const result = await this.collection.insertOne({
      name: data.name,
      usernameKey: data.usernameKey,
      password: data.password,
    });
    const created = await this.collection.findOne({ _id: result.insertedId });
    if (!created) {
      throw new Error('Failed to load created account');
    }
    return created;
  }

  async updatePassword(id: ObjectId, password: string): Promise<void> {
    await this.collection.updateOne({ _id: id }, { $set: { password } });
  }

  async verifyPassword(
    account: WithId<Document>,
    password: string,
  ): Promise<boolean> {
    const hash = account.password;
    if (!hash || typeof hash !== 'string') {
      return password === LEGACY_DEFAULT_PASSWORD;
    }
    return bcrypt.compare(password, hash);
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  toAuthUser(account: WithId<Document>): AuthUserView {
    return {
      _id: String(account._id),
      name: String(account.name ?? ''),
      tier: typeof account.tier === 'string' ? account.tier : null,
      permission:
        typeof account.permission === 'string' ? account.permission : null,
    };
  }

  sanitize(account: WithId<Document>): Record<string, unknown> {
    const {
      password: _password,
      vendorPassword: _vendorPassword,
      _id,
      ...rest
    } = account;

    const safe: Record<string, unknown> = { ...rest, _id: String(_id) };

    if (safe.notionIntegration && typeof safe.notionIntegration === 'object') {
      const notion = { ...(safe.notionIntegration as Record<string, unknown>) };
      delete notion.accessToken;
      safe.notionIntegration = notion;
    }

    if (safe.autoBidProfile && typeof safe.autoBidProfile === 'object') {
      const profile = { ...(safe.autoBidProfile as Record<string, unknown>) };
      for (const field of ['openaiApiKey', 'deepseekApiKey'] as const) {
        profile[`${field}Configured`] = Boolean(profile[field]);
      }
      for (const field of [
        'openaiApiKey',
        'deepseekApiKey',
        'gmailPassword',
        'gmailAppPassword',
        'defaultPassword',
      ]) {
        delete profile[field];
      }
      safe.autoBidProfile = profile;
    }

    return safe;
  }
}
