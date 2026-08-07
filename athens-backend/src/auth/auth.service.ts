import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountInfoService } from './account-info.service';
import {
  AuthMessages,
  MIN_NEW_PASSWORD_LENGTH,
} from './constants/auth.constants';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SignInDto } from './dto/signin.dto';
import { SignUpDto } from './dto/signup.dto';
import { VendorPasswordDto } from './dto/vendor-password.dto';
import { toAuthUser } from './mappers/account.mapper';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly accounts: AccountInfoService,
    private readonly passwords: PasswordService,
  ) {}

  async signin(dto: SignInDto) {
    const name = String(dto.name ?? '').trim();
    const password = String(dto.password ?? '');
    if (!name || !password) {
      throw new BadRequestException(AuthMessages.namePasswordRequired);
    }

    const user = await this.accounts.findByName(name, { exactFirst: true });
    if (!user) {
      throw new UnauthorizedException(AuthMessages.invalidCredentials);
    }

    const valid = await this.passwords.verify(user.password, password);
    if (!valid) {
      throw new UnauthorizedException(AuthMessages.invalidCredentials);
    }

    return {
      success: true,
      user: toAuthUser(user),
      message: AuthMessages.signedIn,
    };
  }

  async signup(dto: SignUpDto) {
    const name = String(dto.name ?? '').trim();
    const password = String(dto.password ?? '');
    if (!name || !password) {
      throw new BadRequestException(AuthMessages.namePasswordRequired);
    }

    const existing = await this.accounts.findByName(name);
    if (existing) {
      throw new ConflictException(AuthMessages.userExists);
    }

    const hashedPassword = await this.passwords.hash(password);
    try {
      const created = await this.accounts.create({
        name,
        usernameKey: this.accounts.usernameKey(name),
        password: hashedPassword,
      });
      return {
        success: true,
        user: toAuthUser(created),
        message: AuthMessages.userCreated,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(AuthMessages.userExists);
      }
      throw error;
    }
  }

  async changePassword(dto: ChangePasswordDto) {
    const name = String(dto.name ?? '').trim();
    const currentPassword = String(dto.currentPassword ?? '');
    const newPassword = String(dto.newPassword ?? '');

    if (!name || !currentPassword || !newPassword) {
      throw new BadRequestException(AuthMessages.changePasswordRequired);
    }
    if (newPassword.length < MIN_NEW_PASSWORD_LENGTH) {
      throw new BadRequestException(AuthMessages.newPasswordTooShort);
    }

    const user = await this.accounts.findByName(name);
    if (!user) {
      throw new NotFoundException(AuthMessages.accountNotFound);
    }

    const valid = await this.passwords.verify(user.password, currentPassword);
    if (!valid) {
      throw new UnauthorizedException(AuthMessages.currentPasswordIncorrect);
    }

    const hashedPassword = await this.passwords.hash(newPassword);
    await this.accounts.updatePassword(user.id, hashedPassword);

    return { success: true, message: AuthMessages.passwordUpdated };
  }

  async setVendorPassword(dto: VendorPasswordDto) {
    const name = String(dto.applierName ?? '').trim();
    if (!name) {
      throw new BadRequestException(AuthMessages.nameRequired);
    }

    const user = await this.accounts.findByName(name);
    if (!user) {
      throw new NotFoundException(AuthMessages.accountNotFound);
    }

    if (dto.clear === true) {
      await this.accounts.updateVendorPassword(user.id, null);
      return { success: true, message: AuthMessages.vendorPasswordCleared };
    }

    const vendorPassword = String(dto.vendorPassword ?? '');
    if (vendorPassword.length < MIN_NEW_PASSWORD_LENGTH) {
      throw new BadRequestException(AuthMessages.vendorPasswordRequired);
    }

    const hashed = await this.passwords.hash(vendorPassword);
    await this.accounts.updateVendorPassword(user.id, hashed);
    return { success: true, message: AuthMessages.vendorPasswordUpdated };
  }
}
