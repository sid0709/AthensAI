import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { MongoServerError } from 'mongodb';
import { AccountInfoService } from './account-info.service';
import { ChangePasswordDto, SignInDto, SignUpDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(private readonly accounts: AccountInfoService) {}

  async signin(dto: SignInDto) {
    const name = String(dto.name ?? '').trim();
    const password = String(dto.password ?? '');
    if (!name || !password) {
      throw new BadRequestException('Name and password are required');
    }

    // Match Athens-server: exact name lookup for sign-in.
    const user = await this.accounts.findByName(name, { exactFirst: true });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await this.accounts.verifyPassword(user, password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      success: true,
      user: this.accounts.toAuthUser(user),
      message: 'Signed in successfully',
    };
  }

  async signup(dto: SignUpDto) {
    const name = String(dto.name ?? '').trim();
    const password = String(dto.password ?? '');
    if (!name || !password) {
      throw new BadRequestException('Name and password are required');
    }

    const existing = await this.accounts.findByName(name);
    if (existing) {
      throw new ConflictException('User already exists');
    }

    const hashedPassword = await this.accounts.hashPassword(password);
    try {
      const created = await this.accounts.create({
        name,
        usernameKey: this.accounts.usernameKey(name),
        password: hashedPassword,
      });
      return {
        success: true,
        user: this.accounts.toAuthUser(created),
        message: 'User created successfully',
      };
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new ConflictException('User already exists');
      }
      throw error;
    }
  }

  async changePassword(dto: ChangePasswordDto) {
    const name = String(dto.name ?? '').trim();
    const currentPassword = String(dto.currentPassword ?? '');
    const newPassword = String(dto.newPassword ?? '');

    if (!name || !currentPassword || !newPassword) {
      throw new BadRequestException(
        'Name, current password, and new password are required',
      );
    }
    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    const user = await this.accounts.findByName(name);
    if (!user) {
      throw new NotFoundException('Account not found');
    }

    const valid = await this.accounts.verifyPassword(user, currentPassword);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedPassword = await this.accounts.hashPassword(newPassword);
    await this.accounts.updatePassword(user._id, hashedPassword);

    return { success: true, message: 'Password updated successfully' };
  }
}
