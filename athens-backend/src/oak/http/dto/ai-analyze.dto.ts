import { Allow, IsOptional, IsString, MinLength } from 'class-validator';

export class OakAiAnalyzeDto {
  @IsString()
  @MinLength(1)
  pureTree!: string;

  @IsString()
  @MinLength(1)
  metaTree!: string;

  /** Opaque page metadata from the extension; null/object both accepted. */
  @IsOptional()
  @Allow()
  page?: Record<string, unknown> | null;
}
