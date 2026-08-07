import { IsArray, IsString, ArrayMaxSize } from 'class-validator';

/** Max jobs per recommend-resumes bulk request (legacy Athens-server contract). */
const MAX_RECOMMEND_JOBS = 40;

export class RecommendResumesDto {
  @IsString()
  applierName!: string;

  @IsArray()
  @ArrayMaxSize(MAX_RECOMMEND_JOBS)
  @IsString({ each: true })
  jobIds!: string[];
}
