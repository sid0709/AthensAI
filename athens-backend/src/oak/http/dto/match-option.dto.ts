import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class OakMatchOptionDto {
  @IsString()
  @MinLength(1)
  intendedValue!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  options!: string[];

  @IsOptional()
  @IsString()
  fieldLabel?: string | null;

  @IsOptional()
  @IsString()
  typedQuery?: string | null;
}
