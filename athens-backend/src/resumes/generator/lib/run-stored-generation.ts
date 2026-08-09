import type { Prisma } from '@prisma/client';
import {
  rawUpdateMany,
  withReplicaSetFallback,
} from '../../../prisma/mongo-standalone';
import { PrismaService } from '../../../prisma/prisma.service';
import { cleanString } from './clean-string';
import type { GenerationStepEvent } from '../resume-generate-pipeline.service';
import { ResumeGenerateFinalizeService } from '../resume-generate-finalize.service';
import { ResumeGeneratePipelineService } from '../resume-generate-pipeline.service';
import { ResumeGeneratePrepareService } from '../resume-generate-prepare.service';

const INPUTS_COLLECTION = 'background_task_inputs';

export type StoredGenerationTask = {
  id: string;
  applierName?: string | null;
  profileId?: string | null;
};

/** Run one BackgroundTaskInput through prepare → pipeline → finalize. */
export async function runStoredResumeGeneration(
  deps: {
    prisma: PrismaService;
    prepare: ResumeGeneratePrepareService;
    pipeline: ResumeGeneratePipelineService;
    finalize: ResumeGenerateFinalizeService;
  },
  task: StoredGenerationTask,
  inputId: string,
  signal: AbortSignal,
  onStep: (step: Record<string, unknown>) => void,
): Promise<{ generationId: string | null; recovered: boolean }> {
  const { prisma, prepare, pipeline, finalize } = deps;
  const input = await prisma.backgroundTaskInput.findUnique({
    where: { id: inputId },
  });
  if (!input) {
    throw Object.assign(new Error('Resume generation input not found'), {
      status: 404,
    });
  }
  if (input.status === 'completed' && input.result) {
    const recovered = input.result as { generationId?: string };
    return {
      generationId: recovered.generationId || null,
      recovered: true,
    };
  }

  throwIfAborted(signal);
  await patchInput(prisma, inputId, {
    status: 'running',
    workerTaskId: task.id,
    startedAt: input.startedAt || new Date(),
    error: null,
  });

  const request =
    input.request && typeof input.request === 'object'
      ? (input.request as Record<string, unknown>)
      : {};
  const body: Record<string, unknown> = {
    ...request,
    applierName: task.applierName,
    profileId: input.profileId || task.profileId || request.profileId,
    backgroundTaskInputId: inputId,
  };

  try {
    const prep = await prepare.prepare(body);
    throwIfAborted(signal);
    if (!prep.ok) {
      throw Object.assign(new Error(prep.error), { status: prep.status });
    }
    body.provider = prep.providerId;
    body.model = prep.model;

    const startedAt = new Date();
    let partialWrite = Promise.resolve();
    const generated = await pipeline.runGeneration(
      prep,
      {
        systemInstruction: cleanString(body.systemInstruction) || undefined,
        identity:
          body.identity && typeof body.identity === 'object'
            ? (body.identity as Record<string, unknown>)
            : null,
        applierName: String(task.applierName || ''),
        jobDescription: cleanString(body.jobDescription) || undefined,
        reasoningEffort: cleanString(body.reasoningEffort) || undefined,
        signal,
      },
      (step: GenerationStepEvent) => {
        if (
          step.phase === 'step-done' &&
          step.kind === 'final' &&
          step.purpose &&
          step.output != null
        ) {
          partialWrite = partialWrite.then(async () => {
            throwIfAborted(signal);
            const fresh = await prisma.backgroundTaskInput.findUnique({
              where: { id: inputId },
              select: { partialSections: true },
            });
            await patchInput(prisma, inputId, {
              partialSections: {
                ...asObject(fresh?.partialSections),
                [String(step.purpose)]: step.output,
              },
            });
            onStep({
              step: `Completed: ${step.name || String(step.purpose)}`,
              stepEvent: step,
            });
          });
          return;
        }
        onStep({
          step:
            step.phase === 'step-start'
              ? `Running: ${step.name || 'Step'}…`
              : step.name || 'Generating résumé…',
          stepEvent: step,
        });
      },
    );
    throwIfAborted(signal);
    await partialWrite;

    const finalized = await finalize.finalize({
      prep,
      body,
      result: generated,
      startedAt,
      signal,
    });

    const storedResult = {
      provider: prep.providerId,
      model: prep.model,
      sections: finalized.sections,
      usage: finalized.usage,
      skillProfile: finalized.skillProfile,
      techStack: finalized.techStack,
      skillAnalysisError: finalized.skillAnalysisError,
      coverageContract: finalized.coverageContract,
      generationId: finalized.generationId
        ? String(finalized.generationId)
        : null,
      isBeta: finalized.isBeta,
      dynamicCareerTitles: finalized.dynamicCareerTitles,
      titlePolicyFingerprint: finalized.titlePolicyFingerprint,
      titlePolicyVersion: finalized.titlePolicyVersion,
    };

    await patchInput(prisma, inputId, {
      status: 'completed',
      result: storedResult,
      error: null,
      finishedAt: new Date(),
    });

    return { generationId: storedResult.generationId, recovered: false };
  } catch (error) {
    await patchInput(prisma, inputId, {
      status: isAbortError(error) || signal.aborted ? 'cancelled' : 'failed',
      error:
        isAbortError(error) || signal.aborted
          ? null
          : error instanceof Error
            ? error.message
            : String(error),
      finishedAt: new Date(),
    }).catch(() => undefined);
    throw error;
  }
}

async function patchInput(
  prisma: PrismaService,
  id: string,
  data: Record<string, unknown>,
) {
  await withReplicaSetFallback(
    () =>
      prisma.backgroundTaskInput.update({
        where: { id },
        data: data as Prisma.BackgroundTaskInputUpdateInput,
      }),
    async () => {
      await rawUpdateMany(
        prisma,
        INPUTS_COLLECTION,
        { _id: id },
        {
          ...data,
          updatedAt: new Date(),
        },
      );
      return null;
    },
  );
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

export function isAbortError(err: unknown): boolean {
  return (
    Boolean(err) &&
    typeof err === 'object' &&
    ((err as { name?: string }).name === 'AbortError' ||
      (err as { code?: string }).code === 'ABORT_ERR')
  );
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw Object.assign(new Error('Resume generation cancelled'), {
    name: 'AbortError',
  });
}
