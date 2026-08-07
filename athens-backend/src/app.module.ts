import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { FirebaseModule } from './firebase/firebase.module';
import { JobsModule } from './jobs/jobs.module';
import { PersonalModule } from './personal/personal.module';
import { PrismaModule } from './prisma/prisma.module';
import { ResumesModule } from './resumes/resumes.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    PersonalModule,
    JobsModule,
    FirebaseModule,
    ResumesModule,
  ],
})
export class AppModule {}
