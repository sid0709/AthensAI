import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { FirebaseAdminService } from '../firebase/firebase-admin.service';
import { storageSlug } from './lib/storage-slug';

const SIGNED_URL_EXPIRES_MS = 15 * 60_000;

export type StoredResumeObject = {
  storagePath: string;
  contentSha256: string;
  sizeBytes: number;
};

/**
 * Firebase Storage for resume binaries.
 * Path: `{slug(ownerName)}_{profileId}/resumes/{sha256}`
 */
@Injectable()
export class ResumeStorageService {
  private readonly logger = new Logger(ResumeStorageService.name);

  constructor(private readonly admin: FirebaseAdminService) {}

  buildPath(ownerName: string, profileId: string, contentSha256: string): string {
    return `${storageSlug(ownerName)}_${profileId}/resumes/${contentSha256}`;
  }

  sha256(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  async put(input: {
    ownerName: string;
    profileId: string;
    fileName: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<StoredResumeObject> {
    const contentSha256 = this.sha256(input.buffer);
    const storagePath = this.buildPath(
      input.ownerName,
      input.profileId,
      contentSha256,
    );
    const bucket = this.admin.storageBucket();
    const file = bucket.file(storagePath);
    await file.save(input.buffer, {
      contentType: input.mimeType || 'application/octet-stream',
      resumable: false,
      metadata: {
        metadata: {
          ownerName: input.ownerName,
          profileId: input.profileId,
          originalFileName: input.fileName,
          sha256: contentSha256,
        },
      },
    });
    return {
      storagePath,
      contentSha256,
      sizeBytes: input.buffer.length,
    };
  }

  async download(storagePath: string): Promise<Buffer | null> {
    const normalized = String(storagePath || '').replace(/^\/+/, '');
    if (!normalized) return null;
    try {
      const [buf] = await this.admin.storageBucket().file(normalized).download();
      return buf;
    } catch (err) {
      this.logger.warn(
        `Resume download failed (${normalized}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  async signedReadUrl(storagePath: string): Promise<string | null> {
    const normalized = String(storagePath || '').replace(/^\/+/, '');
    if (!normalized) return null;
    try {
      const [url] = await this.admin
        .storageBucket()
        .file(normalized)
        .getSignedUrl({
          action: 'read',
          expires: Date.now() + SIGNED_URL_EXPIRES_MS,
          version: 'v4',
        });
      return url;
    } catch {
      return null;
    }
  }

  async delete(storagePath: string): Promise<void> {
    const normalized = String(storagePath || '').replace(/^\/+/, '');
    if (!normalized) return;
    try {
      await this.admin.storageBucket().file(normalized).delete({ ignoreNotFound: true });
    } catch (err) {
      this.logger.warn(
        `Resume delete failed (${normalized}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
