import {
  Controller,
  Get,
  NotFoundException,
  BadRequestException,
  Param,
} from '@nestjs/common';
import { AccountInfoService } from '../auth/account-info.service';

@Controller('account_info')
export class AccountInfoController {
  constructor(private readonly accounts: AccountInfoService) {}

  @Get()
  async list() {
    const rows = await this.accounts.list();
    return rows.map((row) => this.accounts.sanitize(row));
  }

  @Get('by/:name')
  async byName(@Param('name') raw: string) {
    const name = decodeURIComponent(String(raw ?? '')).trim();
    if (!name) {
      throw new BadRequestException('Name is required');
    }
    const doc = await this.accounts.findByName(name);
    if (!doc) {
      throw new NotFoundException('Account not found');
    }
    return { success: true, data: this.accounts.sanitize(doc) };
  }
}
