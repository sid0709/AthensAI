import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { MongoModule } from './mongo/mongo.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [MongoModule, PrismaModule, AuthModule],
})
export class AppModule {}
