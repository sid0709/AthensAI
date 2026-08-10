import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class StartGenerateDto {
  @IsString()
  @MinLength(1)
  applierName!: string;

  @IsArray()
  steps!: Record<string, unknown>[];

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsObject()
  identity?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  jobDescription?: string;

  @IsOptional()
  @IsString()
  systemInstruction?: string;

  @IsOptional()
  @IsObject()
  coverage?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsObject()
  theme?: Record<string, unknown>;

  @IsOptional()
  layout?: unknown;

  @IsOptional()
  @IsString()
  reasoningEffort?: string;

  @IsOptional()
  @IsBoolean()
  dynamicCareerTitles?: boolean;

  @IsOptional()
  @IsString()
  requestId?: string;

  @IsOptional()
  @IsString()
  profileId?: string;

  @IsOptional()
  @IsString()
  identitySyncedAt?: string;

  @IsOptional()
  @IsObject()
  template?: Record<string, unknown>;
}
