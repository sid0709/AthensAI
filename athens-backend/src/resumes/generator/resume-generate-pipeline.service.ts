import { Injectable } from '@nestjs/common';
import { AiChatWithUsageService } from '../../ai-usage/ai-chat-with-usage.service';
import type { ChatMessage } from '../../ai/openai/openai.types';
import { PURPOSE_SET } from './constants/generator.constants';
import { cleanString } from './lib/clean-string';
import {
  normalizeSkillsSectionToContract,
  resumeCoveragePrompt,
} from './lib/coverage-contract';
import {
  buildContextBlock,
  optionalCareerDetailsPrompt,
} from './lib/generation-context';
import { parseJsonLoose } from './lib/parse-json-loose';
import { buildTokenMap, resolveResumePromptSkills } from './lib/token-map';
import {
  appendExperienceTitlePolicy,
  applyTitlePolicyToSections,
  sourceCareers,
} from './lib/title-policy';
import {
  addUsage,
  emptyUsage,
  usageWithCost,
  type GenerationUsage,
} from './lib/usage-aggregate';
import type { PrepareGenerationOk } from './resume-generate-prepare.service';

export type GenerationStepEvent = {
  phase: string;
  index?: number;
  total?: number;
  name?: string;
  purpose?: unknown;
  kind?: unknown;
  usage?: GenerationUsage;
  output?: unknown;
  cumulative?: GenerationUsage;
};

@Injectable()
export class ResumeGeneratePipelineService {
  constructor(private readonly chat: AiChatWithUsageService) {}

  async runGeneration(
    prep: PrepareGenerationOk,
    opts: {
      systemInstruction?: string;
      identity?: Record<string, unknown> | null;
      applierName?: string;
      jobDescription?: string;
      jobSkills?: unknown;
      reasoningEffort?: string;
      signal?: AbortSignal;
    },
    onStep?: (event: GenerationStepEvent) => void,
  ) {
    const throwIfAborted = () => {
      if (!opts.signal?.aborted) return;
      throw Object.assign(new Error('Resume generation cancelled'), {
        name: 'AbortError',
      });
    };
    throwIfAborted();

    const identity = opts.identity ?? {};
    const coverageContract = prep.coverageContract;
    const tokenMap = {
      ...buildTokenMap(
        identity,
        opts.jobDescription,
        resolveResumePromptSkills(opts.jobSkills, coverageContract),
      ),
      source_resume: JSON.stringify(identity, null, 2),
    };
    const applyTokens = (text: unknown) => applyPromptTokens(text, tokenMap);

    const dynamicTitles = Boolean(prep.dynamicCareerTitles);
    const careers = sourceCareers(identity);
    const systemContent = [
      applyTokens(opts.systemInstruction || 'You are an expert resume writer.'),
      buildContextBlock(identity),
      resumeCoveragePrompt(coverageContract),
      optionalCareerDetailsPrompt(identity),
    ]
      .filter(Boolean)
      .join('\n\n');

    const sections: Record<string, unknown> = {};
    const perStep: GenerationStepEvent[] = [];
    let usage = emptyUsage();

    const preparedSteps = prep.steps.map((rawStep, offset) => {
      const step = rawStep || {};
      const index = offset + 1;
      const isFinal = step.kind === 'final';
      const name = cleanString(step.name) || `Step ${index}`;
      let userContent = applyTokens(step.prompt || '');
      if (isFinal && step.purpose === 'experience') {
        userContent = appendExperienceTitlePolicy(userContent, {
          dynamicCareerTitles: dynamicTitles,
          jobDescription: opts.jobDescription,
          careers,
        });
      }
      if (isFinal && step.schema) {
        userContent += `\n\nReturn ONLY a JSON object that conforms to this JSON Schema:\n${
          typeof step.schema === 'string'
            ? step.schema
            : JSON.stringify(step.schema)
        }`;
      }
      return { step, index, isFinal, name, userContent };
    });

    const seriesByPurpose = new Map<string, typeof preparedSteps>();
    for (const prepared of preparedSteps) {
      const purposeKey =
        cleanString(prepared.step.purpose) || `step-${prepared.index}`;
      const series = seriesByPurpose.get(purposeKey) || [];
      series.push(prepared);
      seriesByPurpose.set(purposeKey, series);
    }

    const runPurposeSeries = async (purposeSteps: typeof preparedSteps) => {
      let priorMessages: ChatMessage[] = [];
      for (const prepared of purposeSteps) {
        throwIfAborted();
        const { step, index, isFinal, name, userContent } = prepared;
        onStep?.({
          phase: 'step-start',
          index,
          total: prep.steps.length,
          name,
          purpose: step.purpose,
          kind: step.kind,
        });
        const currentUserMessage: ChatMessage = {
          role: 'user',
          content: userContent,
        };
        const messages: ChatMessage[] = [
          { role: 'system', content: systemContent },
          ...priorMessages,
          currentUserMessage,
        ];
        const featurePurpose =
          cleanString(step.purpose) || cleanString(step.kind) || 'step';
        const { content, usage: stepUsageRaw } = await this.chat.chatCompletion(
          {
            provider: prep.providerId as 'openai' | 'deepseek',
            apiKey: prep.apiKey,
            model: prep.model,
            messages,
            jsonMode: Boolean(isFinal),
            signal: opts.signal,
            usageMeta: {
              feature: `resume-generate:${featurePurpose}`,
              applierName: opts.applierName || prep.applierName,
              path: '/personal/resume-generate',
            },
          },
        );
        throwIfAborted();
        priorMessages = [
          ...priorMessages,
          currentUserMessage,
          { role: 'assistant', content: String(content ?? '') },
        ];

        let output: unknown = content;
        if (isFinal) {
          try {
            output = parseJsonLoose(content);
            if (step.purpose === 'experience') {
              output = applyTitlePolicyToSections(
                { experience: output as Record<string, unknown> },
                identity,
                dynamicTitles,
              )?.experience;
            }
            if (step.purpose === 'skills') {
              output = normalizeSkillsSectionToContract(
                output,
                coverageContract,
              );
            }
          } catch (err) {
            if (Number.isInteger((err as { status?: number })?.status))
              throw err;
            throw Object.assign(
              new Error(
                `${String(step.purpose)} final step returned invalid JSON.`,
              ),
              { status: 502 },
            );
          }
          if (PURPOSE_SET.has(String(step.purpose))) {
            sections[String(step.purpose)] = output;
          }
        }

        const stepUsage = usageWithCost(stepUsageRaw);
        usage = addUsage(usage, stepUsage);
        const entry: GenerationStepEvent = {
          phase: 'step-done',
          index,
          name,
          purpose: step.purpose,
          kind: step.kind,
          usage: stepUsage,
          output,
          cumulative: usage,
        };
        perStep.push(entry);
        onStep?.(entry);
      }
    };

    const seriesResults = await Promise.allSettled(
      [...seriesByPurpose.values()].map((s) => runPurposeSeries(s)),
    );
    const failed = seriesResults.find((r) => r.status === 'rejected');
    if (failed && failed.status === 'rejected') throw failed.reason;
    perStep.sort((a, b) => Number(a.index) - Number(b.index));

    Object.assign(
      sections,
      applyTitlePolicyToSections(sections, identity, dynamicTitles) || {},
    );
    throwIfAborted();

    return {
      sections,
      perStep,
      usage,
      coverageContract: coverageContract ?? null,
      isBeta: Boolean(prep.isBeta),
      dynamicCareerTitles: dynamicTitles,
    };
  }
}

function applyPromptTokens(
  text: unknown,
  tokenMap: Record<string, string>,
): string {
  const unresolved = new Set<string>();
  const resolved = cleanString(text).replace(/\{[a-z0-9_]+\}/gi, (match) => {
    const key = match.slice(1, -1).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(tokenMap, key)) {
      return tokenMap[key];
    }
    unresolved.add(match);
    return match;
  });
  if (unresolved.size) {
    throw Object.assign(
      new Error(
        `Unresolved prompt token${unresolved.size === 1 ? '' : 's'}: ${[...unresolved].join(', ')}.`,
      ),
      { status: 400 },
    );
  }
  return resolved;
}
