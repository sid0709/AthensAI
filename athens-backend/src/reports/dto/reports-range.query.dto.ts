import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

function asTrimmed(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  return '';
}

/** Shared date-range query for Analytics report endpoints. */
export class ReportsRangeQueryDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => asTrimmed(value) || undefined)
  applierName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asTrimmed(value) || undefined)
  startDate?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => asTrimmed(value) || undefined)
  endDate?: string;
}
