import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountInfoService } from './account-info.service';
import { AccountInfoController } from '../account-info/account-info.controller';

@Module({
  controllers: [AuthController, AccountInfoController],
  providers: [AuthService, AccountInfoService],
  exports: [AccountInfoService],
})
export class AuthModule {}
