import { Module, forwardRef } from '@nestjs/common';
import { FirebaseModule } from '../firebase/firebase.module';
import { AccountCascadeDeleteService } from './account-cascade-delete.service';
import { AccountDataPurgeService } from './account-data-purge.service';
import { AccountInfoController } from './account-info.controller';
import { AccountInfoRepository } from './account-info.repository';
import { AccountInfoService } from './account-info.service';
import { AccountStorageCleanupService } from './account-storage-cleanup.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';

@Module({
  imports: [forwardRef(() => FirebaseModule)],
  controllers: [AuthController, AccountInfoController],
  providers: [
    AuthService,
    AccountInfoService,
    AccountInfoRepository,
    PasswordService,
    AccountCascadeDeleteService,
    AccountDataPurgeService,
    AccountStorageCleanupService,
  ],
  exports: [
    AuthService,
    AccountInfoService,
    AccountInfoRepository,
    PasswordService,
  ],
})
export class AuthModule {}
