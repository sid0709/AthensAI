import { Module, forwardRef } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { BackgroundTasksModule } from '../background-tasks/background-tasks.module';
import { PersonalModule } from '../personal/personal.module';
import { ImapClientService } from './imap/imap-client.service';
import { ImapPoolService } from './imap/imap-pool.service';
import { MailAiLabelService } from './mail-ai-label.service';
import { MailAiWriteService } from './mail-ai-write.service';
import { MailCacheService } from './mail-cache.service';
import { MailController } from './mail.controller';
import { MailCredentialsService } from './mail-credentials.service';
import { MailLabelDefinitionsService } from './mail-label-definitions.service';
import { MailService } from './mail.service';
import { MailSyncService } from './mail-sync.service';
import { SmtpClientService } from './smtp/smtp-client.service';

@Module({
  imports: [
    AuthModule,
    PersonalModule,
    AiModule,
    forwardRef(() => BackgroundTasksModule),
  ],
  controllers: [MailController],
  providers: [
    MailService,
    MailCredentialsService,
    MailCacheService,
    MailSyncService,
    MailLabelDefinitionsService,
    MailAiLabelService,
    MailAiWriteService,
    ImapPoolService,
    ImapClientService,
    SmtpClientService,
  ],
  exports: [
    MailService,
    MailCredentialsService,
    MailAiLabelService,
    MailLabelDefinitionsService,
  ],
})
export class MailModule {}
