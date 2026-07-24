# Firebase migration runbook

This runbook moves Athens, AI BFF, Avalon relay, Mongo data, GridFS files, identities, jobs, and caches off the VPS. Production must remain read-only from the final dump until verification passes.

## 0. Access and immutable choices

Before applying infrastructure, an organization administrator must confirm that the deployer can manage Cloud Run, Artifact Registry, load balancing, IAM/service accounts, Cloud Tasks, Scheduler, Cloud KMS, Secret Manager, Memorystore, Monitoring, budgets, Firestore, Storage, Firebase Auth, and Firebase Hosting. `Firebase Admin` alone is not sufficient.

Confirm that the default Firestore database has not been created in the wrong location. The Terraform configuration requires Native mode in `nam7`; the compute region is `us-east4`. Import any already-created default Firestore database and existing bucket into Terraform state before the first apply.

Create a separate staging Firebase project. Never rehearse in production.

## 1. Provision staging

1. Copy `infra/firebase/terraform.tfvars.example` to an untracked tfvars file. Set the API domain, Hosting origin, exact packaged extension origins (or `*` for signed resumable upload URLs), image tag, bucket, billing account, project number, and budget.
2. Initialize and apply `infra/firebase` with `bootstrap_images=true`. The first apply uses Google's public hello image so Cloud Run can be provisioned before the private repository contains an Athens image. It also creates Firestore PITR, daily 14-day backups, weekly 14-week backups, a versioned/soft-delete Storage bucket, KMS, secrets, Cloud Run services/jobs, Tasks queues, Scheduler jobs, Memorystore, audit logs, uptime checks, budget thresholds, and the global HTTPS load balancer.
3. Add current values for the Algolia/OpenAI/DeepSeek secrets in Secret Manager. Do not put secret values in Terraform variables or build substitutions.
4. Run `cloudbuild.images.yaml` once to build and push the three private images without changing traffic. Set `bootstrap_images=false`, set `image_tag` to that commit SHA, and apply Terraform again; this switches services/jobs to the real images, mounts secret versions, and enables health probes.
5. Point the API DNS A record at the Terraform `api_ip_address` output and wait for the managed certificate.
6. Run `cloudbuild.firebase.yaml` using the Terraform-created `athens-deployer` service account. It rebuilds and deploys the three images, packages both Chrome extensions into `/downloads`, updates the Cloud Run services/jobs, and deploys Hosting, rules, and indexes.

Cloud Build assumes Terraform has already created the named services and jobs. Keep Terraform `image_tag` aligned with the deployed commit to prevent a later apply from rolling images backward.

## 2. Audit the source

Run from a trusted migration host with read access to the final Mongo source and Google application credentials:

```bash
cd Athens-server
npm run firebase:audit
```

Review `migration-output/audit.json`. Cutover is blocked by missing/duplicate owner emails or duplicate declared business keys. The report includes every application collection, BSON sizes/types, inline binary fields, both GridFS buckets, and existing target-bucket inventory. Resolve every blocker explicitly; do not silently drop a source row.

Export the vendor identity grants as `MIGRATION_VENDOR_MAP`. Vendor email addresses must be different from all owner email addresses.

## 3. Rehearse

Run the migration against staging:

```bash
npm run firebase:migrate
npm run firebase:auth
npm run firebase:verify
```

The migration preserves Mongo ObjectId hex values, maps both job collections into `jobs`, writes binary data to deterministic Storage paths, and records a source/destination/hash manifest. Re-running it with unchanged source data reuses the verified destination and cannot create duplicates. Accounts with the legacy default password or without a valid bcrypt hash are written to `auth-reset-required.json` and cannot sign in until completing Firebase password reset.

Run the complete test suite and the acceptance checks below against staging. Also execute the `athens-search-rebuild`, `athens-job-analysis-backfill`, and `athens-match-score-backfill` Cloud Run Jobs.

## 4. Production cutover

1. Enable the application maintenance/read-only response.
2. Stop every VPS API, relay, scraper, poller, cron, worker, and extension writer. Confirm Mongo has no active application writers.
3. Create and checksum the final Mongo dump and both GridFS exports. Keep Mongo read-only.
4. Re-run audit, then migration, Auth import, and verification against production.
5. Deploy the Cloud Run revisions and Hosting release with writes still disabled.
6. Keep `firestore_writes_enabled=false`. Test owner and bidder login, denied cross-profile access, REST, both Socket.IO paths, and read-only queries. An admin may exercise isolated production test-profile mutations with `X-Migration-Test: true`; delete those objects and documents afterward. Run upload, render, mail, outbox, retry, and Cloud Run Job acceptance tests fully in staging.
7. Compare every source/destination count and canonical hash, every file SHA-256, Auth/grant mapping, declared unique business key, Firestore index, and representative business query. Any verifier failure blocks release.
8. Take an on-demand Firestore backup, record deployed revisions and Hosting release, then set `firestore_writes_enabled=true` and apply Terraform.

After step 8, Firestore is authoritative. Rollback means moving traffic to a prior Hosting release or Cloud Run revision. Do not resume Mongo writes.

## 5. Acceptance and recovery

The release is accepted only when:

- `firebase:verify` has zero failures and no Firestore document exceeds 900 KiB.
- All GridFS/inline objects have matching byte counts and SHA-256 values.
- Owner/bidder cross-profile requests fail for REST, Socket.IO, upload sessions, and extension flows.
- Algolia can be deleted and rebuilt with `athens-search-rebuild` from Firestore.
- Load, reconnect (including a forced Cloud Run revision change), large upload, worker retry, render, backup restore, and disaster-recovery drills pass.
- No service configuration references the VPS, Mongo, GridFS, local Redis, local monitoring, or a local persistent file path.

Retain the final dump, GridFS export, local manifest, audit/verify reports, deployed-revision record, and read-only VPS for 30 days. Decommission only after written approval; delete data with the organization’s recoverable retention process.
