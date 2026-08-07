import { Body, Controller, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { RecommendResumesDto } from './dto/recommend-resumes.dto';
import { RecommendResumesService } from './recommend-resumes.service';

@Controller('jobs')
export class RecommendResumesController {
  constructor(private readonly recommend: RecommendResumesService) {}

  @Post('recommend-resumes')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  recommendResumes(@Body() body: RecommendResumesDto) {
    return this.recommend.recommendBulk(body);
  }
}
