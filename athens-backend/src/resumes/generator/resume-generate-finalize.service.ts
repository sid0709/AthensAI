import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AccountInfoService } from '../../auth/account-info.service';
import {
  rawInsertOne,
  withReplicaSetFallback,
} from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import { ResumeStorageService } from '../resume-storage.service';
import { ResumeWriteService } from '../resume-write.service';
import { TITLE_POLICY_VERSION } from './constants/generator.constants';
import { cleanString } from './lib/clean-string';
import { sectionsToText } from './lib/sections-to-text';
import {
  computeTitlePolicyFingerprint,
  sourceCareers,
} from './lib/title-policy';
import type { PrepareGenerationOk } from './resume-generate-prepare.service';

const GENERATIONS_COLLECTION = 'resume_generations';

@Injectable()
export class ResumeGenerateFinalizeService {
  private readonly logger = new Logger(ResumeGenerateFinalizeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
    private readonly storage: ResumeStorageService,
    private readonly writes: ResumeWriteService,
  ) {}

  async finalize(input: {
    prep: PrepareGenerationOk;
    body: Record<string, unknown>;
    result: {
      sections: Record<string, unknown>;
      perStep: unknown;
      usage: unknown;
      coverageContract: unknown;
      isBeta?: boolean;
      dynamicCareerTitles?: boolean;
    };
    startedAt: Date;
    signal?: AbortSignal;
  }) {
    throwIfAborted(input.signal);
    const { prep, body, result, startedAt } = input;
    const skillProfile: unknown[] = [];
    const techStack: string | null = null;
    const skillAnalysisError: string | null = null;
    const isBeta = Boolean(prep.isBeta ?? result.isBeta);
    const dynamicCareerTitles = Boolean(
      prep.dynamicCareerTitles ?? result.dynamicCareerTitles,
    );
    const identity =
      body.identity && typeof body.identity === 'object'
        ? (body.identity as Record<string, unknown>)
        : null;
    const titlePolicyFingerprint = computeTitlePolicyFingerprint({
      dynamicCareerTitles,
      jobDescription: body.jobDescription,
      careers: sourceCareers(identity),
      config: body,
    });
    const identitySyncedAt =
      cleanString(body.identitySyncedAt) || new Date().toISOString();
    const applierName = cleanString(body.applierName) || prep.applierName;
    const finishedAt = new Date();
    const data = {
      applierName,
      provider: prep.providerId,
      model: prep.model,
      status: 'completed',
      backgroundTaskInputId: cleanString(body.backgroundTaskInputId) || null,
      config: configSnapshot({
        ...body,
        provider: prep.providerId,
        model: prep.model,
      }) as Prisma.InputJsonValue,
      identity: (identity ?? null) as Prisma.InputJsonValue,
      jobDescription: cleanString(body.jobDescription) || null,
      coverageAnalysis: ((body.coverage as { analysis?: unknown } | undefined)
        ?.analysis ?? null) as Prisma.InputJsonValue,
      coverageContract: (result.coverageContract ??
        null) as Prisma.InputJsonValue,
      sections: result.sections as Prisma.InputJsonValue,
      perStep: result.perStep as Prisma.InputJsonValue,
      usage: result.usage as Prisma.InputJsonValue,
      skillProfile: skillProfile as Prisma.InputJsonValue,
      techStack,
      skillAnalysisError,
      analyzed: false,
      analyzedAt: null,
      isBeta,
      dynamicCareerTitles,
      titlePolicyVersion: TITLE_POLICY_VERSION,
      titlePolicyFingerprint,
      identitySyncedAt,
      identityRefreshedAt: finishedAt,
      startedAt,
      finishedAt,
    };

    throwIfAborted(input.signal);
    const created = await withReplicaSetFallback(
      () => this.prisma.resumeGeneration.create({ data }),
      async () => {
        const now = new Date();
        await rawInsertOne(this.prisma, GENERATIONS_COLLECTION, {
          ...data,
          createdAt: now,
          updatedAt: now,
        });
        const row = await this.prisma.resumeGeneration.findFirst({
          where: {
            applierName,
            backgroundTaskInputId: data.backgroundTaskInputId,
            status: 'completed',
          },
          orderBy: { createdAt: 'desc' },
        });
        if (!row) {
          throw new Error('Failed to load resume_generations after raw insert');
        }
        return row;
      },
    );

    throwIfAborted(input.signal);
    try {
      await this.syncLibrary({
        generationId: created.id,
        ownerName: cleanString(body.applierName) || prep.applierName,
        profileId: prep.profileId,
        sections: result.sections,
        identity,
        templateId: cleanString(body.templateId) || null,
      });
    } catch (err) {
      this.logger.warn(
        `library sync failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      ...result,
      skillProfile,
      techStack,
      skillAnalysisError,
      generationId: created.id,
      coverageContract: result.coverageContract ?? null,
      isBeta,
      dynamicCareerTitles,
      titlePolicyFingerprint,
      titlePolicyVersion: TITLE_POLICY_VERSION,
    };
  }

  private async syncLibrary(input: {
    generationId: string;
    ownerName: string;
    profileId: string;
    sections: Record<string, unknown>;
    identity: Record<string, unknown> | null;
    templateId: string | null;
  }) {
    const account = (await this.accounts.findByName(input.ownerName)) || null;
    const profileId = account?.id || input.profileId;
    if (!profileId || !input.ownerName) return;

    const extractedText = sectionsToText(input.sections, input.identity);
    const fullName =
      cleanString(input.identity?.fullName) || input.ownerName || 'Resume';
    const fileName = `${fullName.replace(/\s+/g, '_')}_generated_${Date.now()}.txt`;
    const buffer = Buffer.from(extractedText || 'Generated resume', 'utf8');
    const stored = await this.storage.put({
      ownerName: input.ownerName,
      profileId,
      fileName,
      mimeType: 'text/plain',
      buffer,
    });

    const existing = await this.prisma.resume.findFirst({
      where: { generationId: input.generationId, ownerName: input.ownerName },
    });

    if (existing) {
      await this.writes.update(existing.id, {
        title: 'Generated',
        fileName,
        mimeType: 'text/plain',
        sizeBytes: stored.sizeBytes,
        storagePath: stored.storagePath,
        contentSha256: stored.contentSha256,
        extractedText,
        templateId: input.templateId,
      });
      return;
    }

    await this.writes.create({
      profileId,
      ownerName: input.ownerName,
      title: 'Generated',
      fileName,
      mimeType: 'text/plain',
      sizeBytes: stored.sizeBytes,
      storagePath: stored.storagePath,
      contentSha256: stored.contentSha256,
      extractedText,
      isPrimary: false,
      source: 'generated',
      generationId: input.generationId,
      templateId: input.templateId,
    });
  }
}

function configSnapshot(body: Record<string, unknown>) {
  return {
    provider: body.provider ?? null,
    model: body.model ?? null,
    reasoningEffort: body.reasoningEffort ?? null,
    dynamicCareerTitles: body.dynamicCareerTitles === true,
    templateId: body.templateId ?? null,
    template: body.template ?? null,
    theme: body.theme ?? null,
    layout: body.layout ?? null,
    systemInstruction: body.systemInstruction ?? null,
    steps: Array.isArray(body.steps) ? body.steps : [],
    coverage:
      body.coverage && typeof body.coverage === 'object'
        ? {
            settings:
              (body.coverage as { settings?: unknown }).settings ?? null,
          }
        : null,
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw Object.assign(new Error('Resume generation cancelled'), {
    name: 'AbortError',
  });
}
