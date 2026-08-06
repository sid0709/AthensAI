import { Module } from '@nestjs/common';
import { AccountInfoController } from './account-info.controller';
import { AccountInfoRepository } from './account-info.repository';
import { AccountInfoService } from './account-info.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

@Module({
  controllers: [AuthController, AccountInfoController],
  providers: [
    AuthService,
    AccountInfoService,
    AccountInfoRepository,
    PasswordService,
  ],
  exports: [AccountInfoService, AccountInfoRepository, PasswordService],
})
export class AuthModule {}
