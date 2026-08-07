import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { StartAiSessionDto } from './dto/start-ai-session.dto';
import { ListTitleReviewQueryDto } from './dto/list-title-review.query.dto';
import { TitleReviewQueryService } from './title-review-query.service';
import { TitleReviewSessionService } from './title-review/title-review-session.service';

@Controller('jobs/title-review')
export class TitleReviewController {
  constructor(
    private readonly titleReview: TitleReviewQueryService,
    private readonly session: TitleReviewSessionService,
  ) {}

  @Get('status')
  status() {
    return this.session.status();
  }

  @Post('start')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  start(@Body() body: StartAiSessionDto) {
    return this.session.start(body);
  }

  @Post('stop')
  stop() {
    return this.session.stop();
  }

  @Get('bootstrap')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async bootstrap(@Query() query: ListTitleReviewQueryDto) {
    const [session, list] = await Promise.all([
      this.session.status(),
      this.titleReview.list(query),
    ]);
    return { ...list, session };
  }

  @Get()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  list(@Query() query: ListTitleReviewQueryDto) {
    return this.titleReview.list(query);
  }
}
