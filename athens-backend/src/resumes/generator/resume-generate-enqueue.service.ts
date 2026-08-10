import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  Inject,
  forwardRef,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AccountInfoService } from '../../auth/account-info.service';
import { BackgroundTasksService } from '../../background-tasks/background-tasks.service';
import { BACKGROUND_TASK_TYPES } from '../../background-tasks/constants/task-types';
import {
  rawInsertOne,
  rawUpdateMany,
  withReplicaSetFallback,
} from '../../prisma/mongo-standalone';
import { PrismaService } from '../../prisma/prisma.service';
import { BACKGROUND_INPUT_RETENTION_MS } from './constants/generator.constants';
import { cleanString } from './lib/clean-string';

const INPUTS_COLLECTION = 'background_task_inputs';

@Injectable()
export class ResumeGenerateEnqueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountInfoService,
    @Inject(forwardRef(() => BackgroundTasksService))
    private readonly backgroundTasks: BackgroundTasksService,
  ) {}

  async enqueue(body: Record<string, unknown>) {
    const applierName = cleanString(body.applierName);
    if (!applierName) {
      throw new BadRequestException({
        success: false,
        error: 'applierName is required',
      });
    }
    if (!Array.isArray(body.steps) || !body.steps.length) {
      throw new BadRequestException({
        success: false,
        error: 'steps are required',
      });
    }

    const account = await this.accounts.findByName(applierName);
    const profileId =
      cleanString(body.profileId) ||
      account?.id ||
      applierName.toLocaleLowerCase('en-US');
    const requestId = cleanString(body.requestId) || randomUUID();
    const inputId = createHash('sha256')
      .update(`${profileId}\0${requestId}\0resume-generation`)
      .digest('hex');

    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + BACKGROUND_INPUT_RETENTION_MS,
    );
    const request = persistedRequest(
      body,
      applierName,
    ) as Prisma.InputJsonValue;

    try {
      await withReplicaSetFallback(
        () =>
          this.prisma.backgroundTaskInput.create({
            data: {
              id: inputId,
              kind: BACKGROUND_TASK_TYPES.RESUME_GENERATION,
              requestId,
              profileId,
              applierName,
              status: 'queued',
              request,
              partialSections: {},
              createdAt,
              expiresAt,
            },
          }),
        async () => {
          await rawInsertOne(this.prisma, INPUTS_COLLECTION, {
            _id: inputId,
            kind: BACKGROUND_TASK_TYPES.RESUME_GENERATION,
            requestId,
            profileId,
            applierName,
            status: 'queued',
            request,
            partialSections: {},
            result: null,
            error: null,
            workerTaskId: null,
            createdAt,
            startedAt: null,
            finishedAt: null,
            updatedAt: createdAt,
            expiresAt,
          });
          return null;
        },
      );
    } catch {
      /* duplicate input id — reuse existing row */
    }

    try {
      const queued = await this.backgroundTasks.create({
        requestId,
        type: BACKGROUND_TASK_TYPES.RESUME_GENERATION,
        profileId,
        applierName: account?.name || applierName,
        payload: { requestRecordIds: [inputId] },
        progress: {
          total: 1,
          operation: 'editor_generation',
          inputId,
        },
      });
      return { ...queued, inputId };
    } catch (error) {
      const failMessage =
        error instanceof Error ? error.message : String(error);
      await withReplicaSetFallback(
        () =>
          this.prisma.backgroundTaskInput.updateMany({
            where: { id: inputId, status: 'queued' },
            data: { status: 'failed', error: failMessage },
          }),
        async () => {
          await rawUpdateMany(
            this.prisma,
            INPUTS_COLLECTION,
            { _id: inputId, status: 'queued' },
            {
              status: 'failed',
              error: failMessage,
              updatedAt: new Date(),
            },
          );
          return { count: 0 };
        },
      ).catch(() => undefined);
      throw error;
    }
  }
}

function persistedRequest(body: Record<string, unknown>, applierName: string) {
  return {
    applierName,
    profileId: body.profileId ?? null,
    provider: body.provider ?? null,
    model: body.model ?? null,
    reasoningEffort: body.reasoningEffort ?? null,
    dynamicCareerTitles: body.dynamicCareerTitles === true,
    templateId: body.templateId ?? null,
    template: body.template ?? null,
    theme: body.theme ?? null,
    layout: body.layout ?? null,
    identity: body.identity ?? null,
    identitySyncedAt: body.identitySyncedAt ?? null,
    systemInstruction: body.systemInstruction ?? null,
    jobDescription: body.jobDescription ?? null,
    steps: Array.isArray(body.steps) ? body.steps : [],
    coverage:
      body.coverage && typeof body.coverage === 'object' ? body.coverage : null,
  };
}
