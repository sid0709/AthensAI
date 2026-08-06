import { Injectable } from '@nestjs/common';
import type { AccountInfo } from '@prisma/client';
import { AccountInfoRepository } from './account-info.repository';

@Injectable()
export class AccountInfoService {
  constructor(private readonly accounts: AccountInfoRepository) {}

  usernameKey(name: string): string {
    return name.trim().toLocaleLowerCase('en-US');
  }

  /** Exact name first (signin contract), then usernameKey fallback. */
  async findByName(
    name: string,
    { exactFirst = false } = {},
  ): Promise<AccountInfo | null> {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return null;

    const exact = await this.accounts.findByExactName(trimmed);
    if (exact || exactFirst) return exact;

    return this.accounts.findByUsernameKey(this.usernameKey(trimmed));
  }

  list(): Promise<AccountInfo[]> {
    return this.accounts.listOrderedByName();
  }

  create(data: {
    name: string;
    usernameKey: string;
    password: string;
  }): Promise<AccountInfo> {
    return this.accounts.create(data);
  }

  updatePassword(id: string, password: string): Promise<void> {
    return this.accounts.updatePassword(id, password);
  }
}
