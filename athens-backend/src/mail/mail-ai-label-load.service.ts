import { Injectable } from '@nestjs/common';
import { MAIL_AI_LABEL_BODY_MAX_CHARS } from '../ai/constants/ai-concurrency.constants';
import { ImapClientService } from './imap/imap-client.service';
import {
  parseMessageId,
  type MailAiLabelLoaded,
  type MailAiLabelResult,
} from './mail-ai-label.parse';
import { MailCacheService } from './mail-cache.service';
import type { MailCredentialsOk } from './mail-credentials.service';

@Injectable()
export class MailAiLabelLoadService {
  constructor(
    private readonly imap: ImapClientService,
    private readonly cache: MailCacheService,
  ) {}

  async loadEmails(
    creds: MailCredentialsOk,
    messageIds: string[],
  ): Promise<{
    emails: MailAiLabelLoaded[];
    loadFailed: Array<{ id: string; result: MailAiLabelResult }>;
  }> {
    const rows = await Promise.all(
      messageIds.map((id) => this.loadOne(creds, id)),
    );
    const emails: MailAiLabelLoaded[] = [];
    const loadFailed: Array<{ id: string; result: MailAiLabelResult }> = [];
    for (const row of rows) {
      if (row.email) emails.push(row.email);
      else if (row.failed) loadFailed.push({ id: row.id, result: row.failed });
    }
    return { emails, loadFailed };
  }

  async fillBodies(
    creds: MailCredentialsOk,
    emails: MailAiLabelLoaded[],
  ): Promise<number> {
    const missing = emails.filter((email) => !email.bodyText);
    if (!missing.length) return 0;
    const byMailbox = new Map<string, MailAiLabelLoaded[]>();
    for (const email of missing) {
      const list = byMailbox.get(email.mailbox) || [];
      list.push(email);
      byMailbox.set(email.mailbox, list);
    }
    await Promise.all(
      [...byMailbox.entries()].map(async ([mailbox, rows]) => {
        const fetched = await this.imap.fetchTextBodiesByUid(
          creds.email,
          creds.password,
          mailbox,
          rows.map((row) => row.uid),
          MAIL_AI_LABEL_BODY_MAX_CHARS * 8,
        );
        const textByUid = new Map(
          fetched.map((row) => [row.uid, String(row.bodyText || '').trim()]),
        );
        for (const row of rows) {
          row.bodyText = textByUid.get(row.uid) || '';
        }
      }),
    );
    return missing.length;
  }

  private async loadOne(
    creds: MailCredentialsOk,
    id: string,
  ): Promise<{
    id: string;
    email?: MailAiLabelLoaded;
    failed?: MailAiLabelResult;
  }> {
    const { mailbox, uid } = parseMessageId(id);
    if (!Number.isFinite(uid) || uid <= 0) {
      return {
        id,
        failed: {
          uid: Number.isFinite(uid) ? uid : 0,
          label: null,
          applied: false,
          reason: 'body_error',
          error: 'Invalid message id',
        },
      };
    }
    let cached = await this.cache.getMessage(creds.applierName, uid, mailbox);
    if (!cached) {
      const env = await this.imap.fetchEnvelopeForUid(
        creds.email,
        creds.password,
        uid,
        creds.applierName,
        mailbox,
      );
      if (env) {
        await this.cache.upsertMessages([env]);
        cached = await this.cache.getMessage(creds.applierName, uid, mailbox);
      }
    }
    if (!cached) {
      return {
        id,
        failed: {
          uid,
          label: null,
          applied: false,
          reason: 'body_error',
          error: 'Message not found',
        },
      };
    }
    return {
      id,
      email: {
        id,
        mailbox,
        uid,
        from: cached.fromName || cached.fromEmail || '',
        subject: cached.subject,
        preview: cached.preview || '',
        bodyText: String(cached.bodyText || '').trim(),
        gmailLabels: cached.gmailLabels || [],
      },
    };
  }
}
