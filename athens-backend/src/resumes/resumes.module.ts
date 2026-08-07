import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { AuthModule } from '../auth/auth.module';
import { FirebaseModule } from '../firebase/firebase.module';
import { AgentJobResumesController } from './agent-job-resumes.controller';
import { AgentJobResumesService } from './agent-job-resumes.service';
import { ResumeAnalyzeController } from './resume-analyze.controller';
import { ResumeAnalyzeProcessService } from './resume-analyze-process.service';
import { ResumeAnalyzeSessionService } from './resume-analyze-session.service';
import { ResumeStorageService } from './resume-storage.service';
import { ResumeTextService } from './resume-text.service';
import { ResumeUploadService } from './resume-upload.service';
import { ResumeWriteService } from './resume-write.service';
import { ResumeLibraryCatalogService } from './resume-library-catalog.service';
import { ResumeService } from './resume.service';
import { ResumesController } from './resumes.controller';

@Module({
  imports: [AuthModule, AiModule, AiUsageModule, FirebaseModule],
  controllers: [
    ResumesController,
    ResumeAnalyzeController,
    AgentJobResumesController,
  ],
  providers: [
    ResumeService,
    ResumeWriteService,
    ResumeUploadService,
    ResumeStorageService,
    ResumeTextService,
    ResumeAnalyzeProcessService,
    ResumeAnalyzeSessionService,
    AgentJobResumesService,
    ResumeLibraryCatalogService,
  ],
  exports: [
    ResumeService,
    ResumeAnalyzeSessionService,
    ResumeLibraryCatalogService,
  ],
})
export class ResumesModule {}
