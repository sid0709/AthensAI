import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UPLOAD_SESSION_TTL_MS } from '../constants/bid-status.constants';

@Injectable()
export class UploadSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    uploadId: string;
    uid?: string | null;
    applierName: string;
    jobId: string;
    sessionId: string;
    storagePath: string;
    contentType: string;
    expectedBytes: number;
    expectedSha256?: string | null;
  }) {
    const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS);
    return this.prisma.uploadSession.create({
      data: {
        id: input.uploadId,
        uid: input.uid ?? null,
        applierName: input.applierName,
        jobId: input.jobId,
        sessionId: input.sessionId,
        storagePath: input.storagePath,
        contentType: input.contentType,
        expectedBytes: input.expectedBytes,
        expectedSha256: input.expectedSha256 ?? null,
        status: 'pending',
        expiresAt,
      },
    });
  }

  async findById(uploadId: string) {
    return this.prisma.uploadSession.findUnique({
      where: { id: String(uploadId) },
    });
  }

  async markCompleted(
    uploadId: string,
    data: {
      actualBytes: number;
      actualSha256?: string | null;
      generation?: string | null;
      contentType?: string;
    },
  ) {
    return this.prisma.uploadSession.update({
      where: { id: uploadId },
      data: {
        status: 'completed',
        actualBytes: data.actualBytes,
        actualSha256: data.actualSha256 ?? null,
        generation: data.generation ?? null,
        ...(data.contentType ? { contentType: data.contentType } : {}),
      },
    });
  }

  async markRejected(
    uploadId: string,
    data: { actualBytes?: number; actualSha256?: string | null },
  ) {
    return this.prisma.uploadSession.update({
      where: { id: uploadId },
      data: {
        status: 'rejected',
        actualBytes: data.actualBytes ?? null,
        actualSha256: data.actualSha256 ?? null,
      },
    });
  }
}
