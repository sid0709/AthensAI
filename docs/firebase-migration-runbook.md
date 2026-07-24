# Firebase data-only migration runbook

Athens UI, API, AI BFF, Avalon relay, workers, Redis, Qdrant, nginx, monitoring, and every `remotepairnet.net` route remain on the VPS. Firestore becomes the document database and the protected US Cloud Storage bucket replaces GridFS and inline binary payloads. Firebase Hosting, Firebase Auth, Cloud Run, Cloud Tasks, Scheduler, and Memorystore are not part of this deployment.

The retained username/password and browser-local identity model is a deliberate compatibility choice. It does not provide server-enforced authorization against an untrusted caller, so the public VPS API must not be described as securely multi-tenant.

## 0. Safety gates

- Rehearse in a separate staging Firebase project. Using production as the rehearsal target requires new, written risk acceptance.
- Keep `FIRESTORE_WRITES_ENABLED=false` through import and verification.
- Never store the VPS service-account JSON in Git, GitHub Actions, a container image, Terraform state, or a Docker environment variable.
- Do not apply the production retirement plan until its destroy list contains only the unused Cloud Run-era resources. Firestore, backups, Storage objects, KMS, audit configuration, and the VPS runtime identity must remain.
- Before cutover, take a final checksummed Mongo dump and both GridFS exports. Keep them and the read-only Mongo volume for 30 days.

## 1. Rehearse in staging

Create a staging project and a globally unique staging bucket name. Initialize the same Terraform code with a separate state prefix:

```bash
cd infra/firebase
terraform init -reconfigure -backend-config="prefix=firebase/staging"
terraform plan -var="project_id=drwretail-bm-staging" -var="storage_bucket=drwretail-bm-staging-migrated" -out=staging.tfplan
terraform apply staging.tfplan
```

If the staging Firestore database or bucket already exists, import it before applying. Confirm Native Firestore is in `nam7`, PITR is enabled, the daily and weekly backup schedules exist, and public access prevention is enforced on the bucket.

Deploy only the data rules and indexes; do not deploy Hosting or Auth:

```bash
firebase deploy --project drwretail-bm-staging --only firestore:rules,firestore:indexes,storage
```

Create a key only for the staging `athens-vps-runtime` identity, install it on the staging migration host with owner-only permissions, and set:

```dotenv
DATABASE_BACKEND=firestore
FIREBASE_PROJECT_ID=drwretail-bm-staging
FIREBASE_STORAGE_BUCKET=drwretail-bm-staging-migrated
GOOGLE_APPLICATION_CREDENTIALS=/absolute/private/path/athens-vps-runtime.json
KMS_KEY_NAME=projects/drwretail-bm-staging/locations/us-east4/keyRings/athens/cryptoKeys/profile-secrets
MIGRATION_INCLUDE_AUTH=false
MONGO_SOURCE_URL=mongodb://source-host:27017
MONGO_SOURCE_DB=AthensDB
```

Run the data-only sequence from `Athens-server`:

```bash
npm run firebase:audit
npm run firebase:migrate
npm run firebase:verify
```

`firebase:audit` does not treat missing or duplicate email addresses as blockers in data-only mode. `firebase:migrate` preserves bcrypt owner and vendor password hashes, ObjectId document IDs, deterministic unique reservations, Storage hashes, and an idempotent manifest. Do not run `firebase:auth`; it is disabled unless `MIGRATION_INCLUDE_AUTH=true` is explicitly set.

Deploy the staging VPS image with writes disabled and test legacy owner/vendor login, account settings, job and mail pagination, résumé/template/recording access, rendering, AI BFF, Avalon, Socket.IO, local workers, Redis/Qdrant, monitoring, container restart recovery, and Algolia reconstruction from Firestore.

## 2. Retire the unused production cloud runtime in two applies

The phase-one checkpoint is commit `bf79473`. It keeps the old resources present, changes Cloud Run deletion protection to `false`, and creates `athens-vps-runtime` with Firestore, Storage, and KMS access. Apply that exact checkpoint from a temporary worktree:

```bash
git worktree add /tmp/athens-firebase-phase1 bf79473
cd /tmp/athens-firebase-phase1/infra/firebase
terraform init -reconfigure -backend-config="prefix=firebase/production"
terraform plan -out=phase1.tfplan
terraform apply phase1.tfplan
```

Review the phase-one plan before applying: it must not delete Cloud Run services, Firestore, Storage, KMS, Redis, or any application data.

Return to the current `main` checkout for phase two:

```bash
cd /path/to/AthensAI/infra/firebase
terraform init -reconfigure -backend-config="prefix=firebase/production"
terraform plan -out=data-only.tfplan
terraform show data-only.tfplan
terraform apply data-only.tfplan
```

The reviewed phase-two plan should remove the Cloud Run services/jobs, load balancer, reserved IP, certificate, serverless NEGs, Memorystore, VPC connector/network, Tasks queues, Scheduler jobs, Artifact Registry, Secret Manager placeholders, old runtime identities, Cloud monitoring checks for the retired API, and the unused deployer. The data resources listed in the safety gates must remain. APIs are removed from Terraform state with `disable_on_destroy=false`, so retiring a resource does not disable shared Google APIs.

After the phase-two apply, deploy the production deny-all client rules and required composite indexes:

```bash
firebase deploy --project drwretail-bm --only firestore:rules,firestore:indexes,storage
```

After the plan succeeds and GitHub no longer has any GCP deployment workflow, remove the unused `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT`, and `GCP_WORKLOAD_IDENTITY_PROVIDER` repository secrets and delete the unused GitHub workload-identity pool after one final access-log check.

## 3. Install the production VPS identity

Create one JSON key for `athens-vps-runtime@drwretail-bm.iam.gserviceaccount.com` using an authorized administrator. Copy it outside the repository to:

```text
/opt/nextoffer/secrets/athens-vps-runtime.json
```

Set the directory to owner-only access, the file to mode `0600`, and mount it read-only. In `/opt/nextoffer/deploy.env` use:

```dotenv
DATABASE_BACKEND=firestore
EMBEDDED_MONGO=false
FIREBASE_PROJECT_ID=drwretail-bm
FIREBASE_STORAGE_BUCKET=drwretail-bm-migrated
FIREBASE_SECRET_HOST_PATH=/opt/nextoffer/secrets/athens-vps-runtime.json
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-service-account.json
KMS_KEY_NAME=projects/drwretail-bm/locations/us-east4/keyRings/athens/cryptoKeys/profile-secrets
FIREBASE_AUTH_REQUIRED=false
BACKGROUND_WORKERS_MODE=local
FIRESTORE_WRITES_ENABLED=false
FIRESTORE_COMPAT_WARN_SCAN=1000
FIRESTORE_COMPAT_MAX_SCAN=20000
SEARCH_OUTBOX_INTERVAL_MS=5000
SEARCH_OUTBOX_BATCH_SIZE=100
```

Keep the existing local `REDIS_URL`, `QDRANT_URL`, Algolia settings, API encryption key, domain routes, monitoring settings, and service ports. The deploy script skips Mongo startup/readiness when Firestore is selected and refuses a missing or incorrectly mounted Google credential.

## 4. Production audit and cutover

1. While Mongo is live, run the data-only audit. Resolve duplicate declared business keys, documents that cannot be reduced below 900 KiB, missing GridFS objects, and unsupported high-volume query patterns.
2. Enter maintenance mode and stop every Mongo writer, scraper, poller, and worker. Confirm no application writer remains.
3. Create and checksum the final Mongo dump and both GridFS exports. Mount or retain the Mongo volume read-only.
4. Run `firebase:migrate` and `firebase:verify` with `MIGRATION_INCLUDE_AUTH=false`. Re-running must reuse deterministic destinations without duplicates.
5. Deploy the VPS image with Firestore selected and `FIRESTORE_WRITES_ENABLED=false`. The read-only gate permits `/auth/signin` and `/auth/bidder-signin` so login can be tested without enabling writes.
6. Test documents, signed file access, rendering, mail, AI BFF, Avalon, Socket.IO, local job-analysis/match-score/search-outbox workers, Prometheus/Grafana, and restart recovery.
7. Require zero verifier failures, matching collection/manifest counts, matching canonical document hashes, matching Storage SHA-256 values, valid reservations, and representative indexed queries.
8. After written sign-off, set `FIRESTORE_WRITES_ENABLED=true` in `deploy.env` and redeploy/restart the VPS container. Never resume Mongo writes after this point.

Before step 8, rollback may redeploy the Mongo-backed VPS image. After step 8, rollback must use a prior Firestore-capable image so newly written Firestore data is not lost.

## 5. Acceptance and retention

- Every source document has exactly one manifest entry or an explicit immutable archive record.
- Every GridFS/inline object has the same byte count and SHA-256 in Storage.
- No Firestore document exceeds 900 KiB.
- Firestore and Storage rules deny direct Firebase client access; only controlled VPS Admin SDK and signed-object paths are used.
- Algolia can be deleted and rebuilt from authoritative Firestore records.
- Legacy owner/vendor login, local workers, retries, restart recovery, backup restore, and VPS monitoring pass.
- No running service depends on Cloud Run, Firebase Auth/Hosting, Tasks, Scheduler, Memorystore, or the retired cloud runtime.

Retain the dump, GridFS exports, manifest, verification report, checksums, deployed image reference, and read-only Mongo volume for 30 days. Remove them only after approved decommissioning.
