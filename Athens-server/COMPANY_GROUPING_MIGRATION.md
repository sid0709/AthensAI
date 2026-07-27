# Company grouping rollout

Company identity is additive: `job_market` remains a flat collection and existing `/jobs/list` callers remain flat unless they send `groupBy: "company"`.

## Before applying

1. Create and verify a current Firestore export.
2. Deploy `firestore.indexes.json` and wait until both company indexes are ready.
3. Run the identity preview (dry-run is the default):

   ```sh
   npm run migrate-company-identity
   ```

4. Review the JSON report in `migration-output/`, especially ambiguous and unknown companies.

## Apply and verify

```sh
npm run migrate-company-identity -- --apply --backup-confirmed
npm run migrate-company-identity -- --verify
npm run backfill-query-ranking
```

The ranking backfill writes `job_rankings_v3`, checks its point count, and moves the `jobs_active` alias only after validation. Grouped directory cache keys include catalog, profile-ranking, account-tier, and job-status revisions, so the alias rebuild also invalidates old directory pages.

Enable `JOB_COMPANY_GROUPING_ENABLED=true` after validation. Keep `JOB_COMPANY_GROUPING_PUBLIC_ENABLED=false` for the Beta-only phase, then set it to `true` for the public singleton rollout. Set the main flag to `false` for an immediate API/UI rollback to the unchanged flat list. The additive Firestore fields may remain. If needed, move `jobs_active` back to the prior ranking collection separately.

## Manual company merge

Preview first, then apply only after confirming the target registry document:

```sh
npm run merge-companies -- --from=cmp_old --to=cmp_canonical
npm run merge-companies -- --from=cmp_old --to=cmp_canonical --apply --backup-confirmed
```

The apply command reassigns market jobs and aliases, marks the old registry row as merged, reindexes affected Qdrant points, and bumps the catalog revision to invalidate grouped Redis directories.
