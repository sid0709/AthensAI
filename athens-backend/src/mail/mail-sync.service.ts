import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ALL_MAIL_PATH } from './constants/mail.constants';
import { ImapClientService } from './imap/imap-client.service';
import { MailCacheService } from './mail-cache.service';
import type { MailCredentialsOk } from './mail-credentials.service';

@Injectable()
export class MailSyncService {
  constructor(
    private readonly imap: ImapClientService,
    private readonly cache: MailCacheService,
  ) {}

  async syncIncremental(creds: MailCredentialsOk) {
    const state = await this.cache.getSyncState(creds.applierName);
    if (state?.syncing) return { newCount: 0, updatedCount: 0, skipped: true };
    await this.cache.upsertSyncState(creds.applierName, { syncing: true });
    try {
      const highest = state?.highestUid ?? 0;
      const messages = await this.imap.fetchNewEnvelopes(
        creds.email,
        creds.password,
        highest,
        creds.applierName,
      );
      if (messages.length) {
        await this.cache.upsertMessages(messages);
        const uids = messages.map((m) => m.uid);
        await this.cache.upsertSyncState(creds.applierName, {
          highestUid: Math.max(highest, ...uids),
          lastSyncAt: new Date(),
          syncing: false,
        });
      } else {
        await this.cache.upsertSyncState(creds.applierName, {
          lastSyncAt: new Date(),
          syncing: false,
        });
      }
      return { newCount: messages.length, updatedCount: 0 };
    } catch (err) {
      await this.cache.upsertSyncState(creds.applierName, { syncing: false });
      throw err;
    }
  }

  async syncInitial(
    creds: MailCredentialsOk,
    opts: { folder?: string; page?: number; pageSize?: number } = {},
  ) {
    const folder = opts.folder || 'inbox';
    const page = opts.page || 1;
    const pageSize = opts.pageSize || 25;
    const { messages, total, mailbox } = await this.imap.fetchMailboxPage(
      creds.email,
      creds.password,
      folder,
      page,
      pageSize,
      creds.applierName,
    );
    if (messages.length) {
      await this.cache.upsertMessages(messages);
      const uids = messages.map((m) => m.uid);
      await this.cache.upsertSyncState(creds.applierName, {
        highestUid: Math.max(...uids),
        lowestUid: Math.min(...uids),
        lastSyncAt: new Date(),
      });
    }
    return { messages, total, page, pageSize, mailbox };
  }

  async refreshLabels(creds: MailCredentialsOk) {
    const labels = await this.imap.fetchGmailLabelList(
      creds.email,
      creds.password,
    );
    await this.cache.upsertSyncState(creds.applierName, {
      gmailLabelsJson: labels,
    });
    return labels;
  }

  async refreshFolderCounts(creds: MailCredentialsOk, force = false) {
    const state = await this.cache.getSyncState(creds.applierName);
    if (
      !force &&
      state?.folderCountsJson &&
      state.lastSyncAt &&
      Date.now() - state.lastSyncAt.getTime() < 60_000
    ) {
      return {
        counts: state.folderCountsJson as Record<
          string,
          { total: number; unread: number; badge: number }
        >,
        cached: true,
      };
    }
    const counts = await this.imap.fetchFolderCounts(
      creds.email,
      creds.password,
    );
    await this.cache.upsertSyncState(creds.applierName, {
      folderCountsJson: counts,
    });
    return { counts, cached: false };
  }
}
