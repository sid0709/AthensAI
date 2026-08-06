import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PersonalModule } from './personal/personal.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, AuthModule, PersonalModule],
})
export class AppModule {}
