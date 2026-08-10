import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { StartGenerateDto } from './dto/start-generate.dto';
import { ResumeGenerateEnqueueService } from './resume-generate-enqueue.service';
import { ResumeGenerationTaskService } from './resume-generation-task.service';

@Controller('personal')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class ResumeGenerateController {
  constructor(
    private readonly enqueue: ResumeGenerateEnqueueService,
    private readonly tasks: ResumeGenerationTaskService,
  ) {}

  @Post('resume-generate')
  @HttpCode(202)
  start(@Body() body: StartGenerateDto) {
    return this.enqueue.enqueue(body as unknown as Record<string, unknown>);
  }

  @Get('resume-generation-tasks/:inputId')
  async taskResult(
    @Param('inputId') inputId: string,
    @Query('applierName') applierName: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.tasks.get(inputId, applierName);
    res.status(result.httpStatus);
    return result.body;
  }
}
