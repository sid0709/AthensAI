import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';

/** POST /jobs/company/apply-others — mark other roles at a company applied. */
export class ApplyOtherCompanyJobsDto {
  @IsString()
  applierName!: string;

  @IsString()
  companyId!: string;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  keepJobIds!: string[];

  @IsOptional()
  @IsString()
  mutationId?: string;
}
