import { Controller, Get } from '@nestjs/common';
import { SkillExtractQueryService } from './skill-extract-query.service';

@Controller('jobs/skill-extract')
export class SkillExtractController {
  constructor(private readonly skillExtract: SkillExtractQueryService) {}

  /** Pending badge for Job Search “Extract skills”. AI run not wired yet. */
  @Get('status')
  status() {
    return this.skillExtract.status();
  }
}
