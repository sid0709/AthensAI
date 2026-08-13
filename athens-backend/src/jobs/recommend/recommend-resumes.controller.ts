import {
  Body,
  Controller,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { RecommendResumesDto } from './dto/recommend-resumes.dto';
import { SetRecommendedResumeDto } from './dto/set-recommended-resume.dto';
import { RecommendResumesService } from './recommend-resumes.service';
import { SetRecommendedResumeService } from './set-recommended-resume.service';

@Controller('jobs')
export class RecommendResumesController {
  constructor(
    private readonly recommend: RecommendResumesService,
    private readonly setRecommended: SetRecommendedResumeService,
  ) {}

  /** Recommend Library resume stacks for Bid Ready or Worker pool jobs. */
  @Post('recommend-resumes')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  recommendResumes(@Body() body: RecommendResumesDto) {
    return this.recommend.recommendBulk(body);
  }

  /** Manually assign a Library resume stack to a Bid Ready or Worker pool job. */
  @Post('set-recommended-resume')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  setRecommendedResume(@Body() body: SetRecommendedResumeDto) {
    return this.setRecommended.setManual(body);
  }
}
