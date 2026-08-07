import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ListTitleReviewQueryDto } from './dto/list-title-review.query.dto';
import { TitleReviewQueryService } from './title-review-query.service';

@Controller('jobs/title-review')
export class TitleReviewController {
  constructor(private readonly titleReview: TitleReviewQueryService) {}

  @Get('status')
  status() {
    return this.titleReview.status();
  }

  @Get('bootstrap')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  bootstrap(@Query() query: ListTitleReviewQueryDto) {
    return this.titleReview.bootstrap(query);
  }

  @Get()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  list(@Query() query: ListTitleReviewQueryDto) {
    return this.titleReview.list(query);
  }
}
