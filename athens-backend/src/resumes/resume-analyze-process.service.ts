import { Injectable } from '@nestjs/common';
import type { Resume, Prisma } from '@prisma/client';
import type { ProfileLlmAuth } from '../ai/auth/profile-llm-auth.service';
import { OpenAiChatService } from '../ai/openai/openai-chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { RESUME_SKILL_ANALYSIS_PROMPT } from './analyze/resume-skill-analysis.prompt';
import { parseSkillProfileJson } from './analyze/resume-skill-parse';
import { RESUME_ANALYZE_TEXT_MAX_CHARS } from './constants/resume-skill.constants';
import type { ResumeAnalysisObject } from './mappers/resume.mapper';
import { ResumeCatalogSyncService } from './resume-catalog-sync.service';

export type ResumeAnalyzeItemResult = {
  resumeId: string;
  status: 'completed' | 'failed' | 'skipped';
  alreadyAnalyzed?: boolean;
  skillCount?: number;
  error?: string;
};

@Injectable()
export class ResumeAnalyzeProcessService {
  constructor(
    private readonly chat: OpenAiChatService,
    private readonly prisma: PrismaService,
    private readonly catalog: ResumeCatalogSyncService,
  ) {}

  async analyzeOne(input: {
    resume: Resume;
    auth: ProfileLlmAuth;
    force: boolean;
    signal?: AbortSignal;
  }): Promise<ResumeAnalyzeItemResult> {
    const { resume, auth, force, signal } = input;

    if (resume.analyzed && !force) {
      return {
        resumeId: resume.id,
        status: 'skipped',
        alreadyAnalyzed: true,
        skillCount: skillCountOf(resume),
      };
    }

    const text = String(resume.extractedText || '').trim();
    if (!text) {
      const message = 'No extracted text available for analysis';
      await this.prisma.resume.update({
        where: { id: resume.id },
        data: { analysisError: message, analyzed: false },
      });
      return { resumeId: resume.id, status: 'failed', error: message };
    }

    const truncated = text.slice(0, RESUME_ANALYZE_TEXT_MAX_CHARS);

    try {
      const result = await this.chat.chatCompletion({
        apiKey: auth.apiKey,
        model: auth.model,
        provider: auth.provider,
        jsonMode: true,
        signal,
        messages: [
          { role: 'system', content: RESUME_SKILL_ANALYSIS_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              fileName: resume.fileName,
              title: resume.title,
              resumeText: truncated,
            }),
          },
        ],
      });

      const skills = parseSkillProfileJson(result.content);
      if (!skills.length) {
        const message = 'Model returned no skills';
        await this.prisma.resume.update({
          where: { id: resume.id },
          data: { analysisError: message, analyzed: false },
        });
        return { resumeId: resume.id, status: 'failed', error: message };
      }

      const analysis = {
        skills,
        provider: auth.provider,
        model: auth.model,
        usage: result.usage ?? null,
      } as Prisma.InputJsonValue;

      await this.prisma.resume.update({
        where: { id: resume.id },
        data: {
          analyzed: true,
          analyzedAt: new Date(),
          analysis,
          analysisError: null,
        },
      });

      await this.catalog.syncStack(resume.profileId, resume.title);

      return {
        resumeId: resume.id,
        status: 'completed',
        skillCount: skills.length,
      };
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.resume.update({
        where: { id: resume.id },
        data: { analysisError: message },
      });
      return { resumeId: resume.id, status: 'failed', error: message };
    }
  }
}

function skillCountOf(resume: Resume): number {
  const a = resume.analysis;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return 0;
  const skills = (a as ResumeAnalysisObject).skills;
  return Array.isArray(skills) ? skills.length : 0;
}
