import { Controller, Get } from '@nestjs/common';
import { AiAnalyzeSessionService } from './ai-analyze/ai-analyze-session.service';

/** Legacy route alias for AI Analyze status (Job Search “Extract skills” badge). */
@Controller('jobs/skill-extract')
export class SkillExtractController {
  constructor(private readonly aiAnalyze: AiAnalyzeSessionService) {}

  @Get('status')
  status() {
    return this.aiAnalyze.status();
  }
}
