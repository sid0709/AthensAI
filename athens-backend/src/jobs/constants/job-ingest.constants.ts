/** Schema stamp written on scrape ingest into temp_jobs / promoted jobs. */
export const JOB_MODEL_SCHEMA_CODE = '2026.08.06-temp-ingest-v1';

/** Extension scrape provenance when the client does not send createdBy/sender. */
export const EXTENSION_CREATED_BY = 'avalon-scrapper';

export const JOB_SOURCE_CATALOGS = {
  MARKET: 'market',
  EXTERNAL: 'external',
} as const;

/** Default aiSkillStatus for newly scraped temp rows. */
export const JOB_AI_SKILL_STATUS_PENDING = 'pending';
