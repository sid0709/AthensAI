import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { BidsModule } from '../bids/bids.module';
import { MailModule } from '../mail/mail.module';
import { PersonalModule } from '../personal/personal.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AthensLensAuthController } from './athens-lens-auth.controller';
import { AthensLensController } from './athens-lens.controller';
import { LensAskAiService } from './lens-ask-ai.service';
import { LensAuthGuard } from './lens-auth.guard';
import { LensAuthService } from './lens-auth.service';
import { LensJobsService } from './lens-jobs.service';
import { LensSessionService } from './lens-session.service';

@Module({
  imports: [PrismaModule, BidsModule, AiModule, PersonalModule, MailModule],
  controllers: [AthensLensAuthController, AthensLensController],
  providers: [
    LensSessionService,
    LensAuthService,
    LensAuthGuard,
    LensJobsService,
    LensAskAiService,
  ],
})
export class AthensLensModule {}
