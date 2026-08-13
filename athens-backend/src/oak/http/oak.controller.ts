import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { OakAuthGuard, type OakAuthedRequest } from '../auth/oak-auth.guard';
import { OakAnalyzeService } from '../ai/oak-analyze.service';
import { OakMatchOptionService } from '../ai/oak-match-option.service';
import { OakGatewayBootstrap } from '../gateway/oak-gateway.bootstrap';
import { OakAiAnalyzeDto } from './dto/ai-analyze.dto';
import { OakMatchOptionDto } from './dto/match-option.dto';
import { OakJobsService } from './oak-jobs.service';
import { OakRecommendedResumeService } from './oak-recommended-resume.service';
import { OakRuntimeFileService } from './oak-runtime-file.service';

@Controller('oak')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class OakController {
  private readonly logger = new Logger(OakController.name);

  constructor(
    private readonly analyze: OakAnalyzeService,
    private readonly matchOption: OakMatchOptionService,
    private readonly runtimeFiles: OakRuntimeFileService,
    private readonly jobs: OakJobsService,
    private readonly recommendedResume: OakRecommendedResumeService,
    private readonly gateway: OakGatewayBootstrap,
  ) {}

  @Get('health')
  health() {
    return {
      ok: true,
      clients: this.gateway.clientCount(),
    };
  }

  @Post('ai-analyze')
  @UseGuards(OakAuthGuard)
  async aiAnalyze(@Req() req: OakAuthedRequest, @Body() dto: OakAiAnalyzeDto) {
    const session = req.oakSession!;
    try {
      return await this.analyze.analyze({
        profileId: session.profileId,
        applierName: session.applierName,
        pureTree: dto.pureTree,
        metaTree: dto.metaTree,
        page: dto.page ?? null,
      });
    } catch (err) {
      this.logger.warn(
        `ai-analyze failed for ${session.applierName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  @Post('match-option')
  @UseGuards(OakAuthGuard)
  match(@Req() req: OakAuthedRequest, @Body() dto: OakMatchOptionDto) {
    const session = req.oakSession!;
    return this.matchOption.match({
      profileId: session.profileId,
      applierName: session.applierName,
      intendedValue: dto.intendedValue,
      options: dto.options,
      fieldLabel: dto.fieldLabel,
      typedQuery: dto.typedQuery,
    });
  }

  @Get('runtime-file')
  @UseGuards(OakAuthGuard)
  getRuntimeFile() {
    return this.runtimeFiles.getRuntimeFile();
  }

  @Get('jobs')
  @UseGuards(OakAuthGuard)
  listJobs(@Req() req: OakAuthedRequest) {
    return this.jobs.list(req.oakSession!.applierName);
  }

  /** Library resume assigned by Job Search Recommend for a Worker pool job. */
  @Get('jobs/:jobId/recommended-resume')
  @UseGuards(OakAuthGuard)
  getRecommendedResume(
    @Req() req: OakAuthedRequest,
    @Param('jobId') jobId: string,
  ) {
    return this.recommendedResume.getForJob(
      req.oakSession!.applierName,
      jobId,
    );
  }
}
