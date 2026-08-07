import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_MAIL_PATH } from './constants/mail.constants';
import {
  extractCustomLabels,
  labelsMatchFilter,
  type MailMessageDoc,
} from './mappers/folder-mapper';

@Injectable()
export class MailCacheService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertMessages(messages: MailMessageDoc[]) {
    for (const m of messages) {
      await this.prisma.mailMessage.upsert({
        where: {
          applierName_mailbox_uid: {
            applierName: m.applierName,
            mailbox: m.mailbox,
            uid: m.uid,
          },
        },
        create: {
          applierName: m.applierName,
          mailbox: m.mailbox,
          uid: m.uid,
          messageId: m.messageId,
          fromName: m.from.name,
          fromEmail: m.from.email,
          toJson: m.to as unknown as Prisma.InputJsonValue,
          ccJson: m.cc as unknown as Prisma.InputJsonValue,
          subject: m.subject,
          preview: m.preview,
          bodyText: m.bodyText || null,
          bodyHtml: m.bodyHtml,
          date: m.date,
          seen: m.flags.seen,
          flagged: m.flags.flagged,
          gmailLabels: m.gmailLabels,
          folder: m.folder,
          labels: m.labels,
          hasBody: m.hasBody,
          syncedAt: m.syncedAt,
        },
        update: {
          messageId: m.messageId,
          fromName: m.from.name,
          fromEmail: m.from.email,
          toJson: m.to as unknown as Prisma.InputJsonValue,
          ccJson: m.cc as unknown as Prisma.InputJsonValue,
          subject: m.subject,
          preview: m.preview || undefined,
          date: m.date,
          seen: m.flags.seen,
          flagged: m.flags.flagged,
          gmailLabels: m.gmailLabels,
          folder: m.folder,
          labels: m.labels,
          syncedAt: m.syncedAt,
        },
      });
    }
  }

  async updateMessageBody(
    applierName: string,
    uid: number,
    patch: { bodyText: string; bodyHtml: string | null; preview: string },
    mailbox = ALL_MAIL_PATH,
  ) {
    await this.prisma.mailMessage.updateMany({
      where: { applierName, mailbox, uid },
      data: {
        bodyText: patch.bodyText,
        bodyHtml: patch.bodyHtml,
        preview: patch.preview || undefined,
        hasBody: true,
      },
    });
  }

  async updateMessageFlags(
    applierName: string,
    uid: number,
    patch: {
      seen?: boolean;
      flagged?: boolean;
      folder?: string;
      gmailLabels?: string[];
      labels?: string[];
    },
    mailbox = ALL_MAIL_PATH,
  ) {
    const data: Prisma.MailMessageUpdateManyMutationInput = {};
    if (typeof patch.seen === 'boolean') data.seen = patch.seen;
    if (typeof patch.flagged === 'boolean') data.flagged = patch.flagged;
    if (patch.folder) data.folder = patch.folder;
    if (patch.gmailLabels) {
      data.gmailLabels = patch.gmailLabels;
      data.labels = extractCustomLabels(patch.gmailLabels);
    }
    if (patch.labels) data.labels = patch.labels;
    if (Object.keys(data).length === 0) return;
    await this.prisma.mailMessage.updateMany({
      where: { applierName, mailbox, uid },
      data,
    });
  }

  async getMessage(applierName: string, uid: number, mailbox?: string) {
    if (mailbox) {
      return this.prisma.mailMessage.findUnique({
        where: {
          applierName_mailbox_uid: { applierName, mailbox, uid },
        },
      });
    }
    return this.prisma.mailMessage.findFirst({
      where: { applierName, uid },
      orderBy: { syncedAt: 'desc' },
    });
  }

  async listMessages(
    applierName: string,
    opts: {
      folder?: string;
      label?: string;
      search?: string;
      unlabeled?: boolean;
      page?: number;
      pageSize?: number;
      mailbox?: string;
    } = {},
  ) {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize || 25));
    const where: Prisma.MailMessageWhereInput = { applierName };
    if (opts.mailbox) where.mailbox = opts.mailbox;
    if (opts.folder && opts.folder !== 'all') where.folder = opts.folder;
    if (opts.search?.trim()) {
      const q = opts.search.trim();
      where.OR = [
        { subject: { contains: q, mode: 'insensitive' } },
        { fromName: { contains: q, mode: 'insensitive' } },
        { fromEmail: { contains: q, mode: 'insensitive' } },
        { preview: { contains: q, mode: 'insensitive' } },
      ];
    }

    let rows = await this.prisma.mailMessage.findMany({
      where,
      orderBy: { date: 'desc' },
      take: opts.unlabeled || opts.label ? 500 : pageSize,
      skip: opts.unlabeled || opts.label ? 0 : (page - 1) * pageSize,
    });

    if (opts.label) {
      rows = rows.filter((r) => labelsMatchFilter(r.gmailLabels, opts.label));
    }
    if (opts.unlabeled) {
      rows = rows.filter(
        (r) =>
          r.folder === 'inbox' &&
          extractCustomLabels(r.gmailLabels).length === 0,
      );
    }

    const total = opts.unlabeled || opts.label
      ? rows.length
      : await this.prisma.mailMessage.count({ where });

    if (opts.unlabeled || opts.label) {
      const start = (page - 1) * pageSize;
      rows = rows.slice(start, start + pageSize);
    }

    return { rows, total, page, pageSize, hasMore: page * pageSize < total };
  }

  async getSyncState(applierName: string) {
    return this.prisma.mailSyncState.findUnique({ where: { applierName } });
  }

  async upsertSyncState(
    applierName: string,
    patch: {
      highestUid?: number;
      lowestUid?: number;
      lastSyncAt?: Date;
      syncing?: boolean;
      gmailLabelsJson?: Prisma.InputJsonValue;
      folderCountsJson?: Prisma.InputJsonValue;
    },
  ) {
    return this.prisma.mailSyncState.upsert({
      where: { applierName },
      create: {
        applierName,
        highestUid: patch.highestUid ?? 0,
        lowestUid: patch.lowestUid ?? 0,
        lastSyncAt: patch.lastSyncAt,
        syncing: patch.syncing ?? false,
        gmailLabelsJson: patch.gmailLabelsJson,
        folderCountsJson: patch.folderCountsJson,
      },
      update: {
        ...(typeof patch.highestUid === 'number'
          ? { highestUid: patch.highestUid }
          : {}),
        ...(typeof patch.lowestUid === 'number'
          ? { lowestUid: patch.lowestUid }
          : {}),
        ...(patch.lastSyncAt ? { lastSyncAt: patch.lastSyncAt } : {}),
        ...(typeof patch.syncing === 'boolean'
          ? { syncing: patch.syncing }
          : {}),
        ...(patch.gmailLabelsJson !== undefined
          ? { gmailLabelsJson: patch.gmailLabelsJson }
          : {}),
        ...(patch.folderCountsJson !== undefined
          ? { folderCountsJson: patch.folderCountsJson }
          : {}),
      },
    });
  }
}
