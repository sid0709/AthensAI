import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { OakAuthController } from './auth/oak-auth.controller';
import { OakAuthGuard } from './auth/oak-auth.guard';
import { OakAuthService } from './auth/oak-auth.service';
import { OakSessionService } from './auth/oak-session.service';
import { OakAnalyzeService } from './ai/oak-analyze.service';
import { OakMatchOptionService } from './ai/oak-match-option.service';
import { OakProfilePromptService } from './ai/oak-profile-prompt.service';
import { OakResponsesService } from './ai/oak-responses.service';
import { OakGatewayBootstrap } from './gateway/oak-gateway.bootstrap';
import { OakController } from './http/oak.controller';
import { OakRuntimeFileService } from './http/oak-runtime-file.service';

@Module({
  imports: [PrismaModule, AuthModule, AiModule, AiUsageModule],
  controllers: [OakAuthController, OakController],
  providers: [
    OakSessionService,
    OakAuthService,
    OakAuthGuard,
    OakProfilePromptService,
    OakResponsesService,
    OakAnalyzeService,
    OakMatchOptionService,
    OakRuntimeFileService,
    OakGatewayBootstrap,
  ],
  exports: [OakGatewayBootstrap, OakSessionService],
})
export class OakModule {}
