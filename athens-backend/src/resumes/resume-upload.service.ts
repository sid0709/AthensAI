import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountInfoService } from '../auth/account-info.service';
import { OBJECT_ID_PATTERN } from '../personal/constants/profile-field.constants';
import { asText } from '../personal/mappers/as-text';
import { PrismaService } from '../prisma/prisma.service';
import {
  RESUME_ALLOWED_MIME,
  RESUME_MIME_HINT,
} from './constants/resume-mime.constants';
import {
  toResumeSummary,
  type UserResumeSummary,
} from './mappers/resume.mapper';
import { ResumeStorageService } from './resume-storage.service';
import { ResumeTextService } from './resume-text.service';

@Injectable()
export class ResumeUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
    private readonly storage: ResumeStorageService,
    private readonly text: ResumeTextService,
  ) {}

  async create(input: {
    ownerName: string;
    ownerId: string;
    techStack: string;
    fileName: string;
    mimeType: string;
    contentBase64: string;
  }): Promise<UserResumeSummary> {
    const ownerName = asText(input.ownerName).trim();
    const title = asText(input.techStack).trim();
    const fileName = asText(input.fileName).trim();
    const mimeType =
      asText(input.mimeType).trim() || 'application/octet-stream';
    const contentBase64 = String(input.contentBase64 || '');
    const ownerId = asText(input.ownerId).trim();

    if (!ownerName) throw bad('ownerName is required');
    if (!title) throw bad('techStack is required');
    if (!fileName) throw bad('fileName is required');
    if (!contentBase64) throw bad('contentBase64 is required');
    if (!OBJECT_ID_PATTERN.test(ownerId)) throw bad('Valid ownerId is required');

    const acc = await this.resolveOwner(ownerName, ownerId);
    const buffer = Buffer.from(contentBase64, 'base64');
    if (!buffer.length) throw bad('Empty file content');

    if (
      !RESUME_ALLOWED_MIME.has(mimeType) &&
      !/\.(pdf|docx?|txt)$/i.test(fileName)
    ) {
      throw bad(RESUME_MIME_HINT);
    }

    const extractedText = await this.text.extract(buffer, mimeType, fileName);
    const stored = await this.storage.put({
      ownerName: acc.name,
      profileId: acc.id,
      fileName,
      mimeType,
      buffer,
    });

    const existingCount = await this.prisma.resume.count({
      where: { profileId: acc.id },
    });

    const row = await this.prisma.resume.create({
      data: {
        profileId: acc.id,
        ownerName: acc.name,
        title,
        fileName,
        mimeType,
        sizeBytes: stored.sizeBytes,
        storagePath: stored.storagePath,
        contentSha256: stored.contentSha256,
        extractedText,
        isPrimary: existingCount === 0,
        source: 'uploaded',
      },
    });

    return toResumeSummary(row);
  }

  async bulkCreate(input: {
    ownerName: string;
    ownerId: string;
    items: Array<{
      ownerName?: string;
      ownerId?: string;
      techStack: string;
      fileName: string;
      mimeType: string;
      contentBase64: string;
    }>;
  }): Promise<{
    ok: UserResumeSummary[];
    failed: { fileName: string; error: string }[];
  }> {
    const ok: UserResumeSummary[] = [];
    const failed: { fileName: string; error: string }[] = [];
    for (const item of input.items || []) {
      try {
        ok.push(
          await this.create({
            ownerName: item.ownerName || input.ownerName,
            ownerId: item.ownerId || input.ownerId,
            techStack: item.techStack,
            fileName: item.fileName,
            mimeType: item.mimeType,
            contentBase64: item.contentBase64,
          }),
        );
      } catch (err) {
        failed.push({
          fileName: item?.fileName || 'unknown',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { ok, failed };
  }

  private async resolveOwner(ownerName: string, ownerId: string) {
    const byId = await this.prisma.accountInfo.findUnique({
      where: { id: ownerId },
    });
    if (byId) return byId;
    const byName = await this.accounts.findByName(ownerName);
    if (!byName) throw bad('Account not found');
    return byName;
  }
}

function bad(message: string): BadRequestException {
  return new BadRequestException({ success: false, message, error: message });
}
