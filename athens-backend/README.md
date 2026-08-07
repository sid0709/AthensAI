# athens-backend

NestJS + Prisma API for Athens. Replaces `Athens-server` for the Athens app, starting with authentication and Settings auto-bid profile against MongoDB `AthensDB.account_info`.

## Stack

- NestJS 11
- Prisma 6 (MongoDB — Prisma 7 does not support Mongo yet)
- bcrypt cost 10 (Athens-server contract)
- Acceptance criteria: [`athens-backend-rules.md`](athens-backend-rules.md)

## Setup

```bash
cp .env.example .env
# Set DATABASE_URL — database name must be AthensDB
npm install
npm run prisma:generate
npm run start:dev
```

Default listen: `http://127.0.0.1:8980/api`

### Mongo notes

- Schema and indexes: `prisma/schema.prisma` + `npm run prisma:push`
- Reads use typed Prisma Client via `PrismaService`
- Standalone Mongo (no replica set) cannot run Prisma transactional writes; `AccountInfoRepository` falls back to `$runCommandRaw` for create/password update only. Prefer enabling a replica set in production so typed writes succeed.

## Auth contract (Athens-compatible)

| Method | Path | Body |
|--------|------|------|
| POST | `/api/auth/signin` | `{ name, password }` |
| POST | `/api/auth/signup` | `{ name, password }` |
| POST | `/api/auth/change-password` | `{ name, currentPassword, newPassword }` |
| GET | `/api/account_info` | — |
| GET | `/api/account_info/by/:name` | — |

Sign-in / sign-up responses: `{ success, user: { _id, name, tier, permission }, message }`.

## Profile contract (Athens-compatible)

| Method | Path | Notes |
|--------|------|------|
| GET | `/api/personal/auto-bid-profile?applierName=&profileId=` | Returns `{ success, accountExists, vendorAllowed, vendorPasswordSet, profile }` |
| PUT | `/api/personal/auto-bid-profile` | Body: `{ applierName, profileId?, vendorAllowed?, ...profileFields }` |

Profile secrets (`openaiApiKey`, `deepseekApiKey`, `gmailAppPassword`, `defaultPassword`, …) use local `enc:v1:` via `API_KEYS_ENCRYPTION_KEY` only.

| Method | Path | Notes |
|--------|------|------|
| GET | `/api/personal/llm-models?provider=&applierName=&profileId=` | OpenAI catalog (needs decrypted profile key) or DeepSeek fixed list |
| POST | `/api/personal/default-model` | `{ applierName, provider, model, profileId? }` — validates key then saves |
| POST | `/api/personal/llm-key-check` | `{ provider, apiKey?, applierName? }` |

## Job Search catalog (read-only)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/jobs` | Query: `status`, `q`, `company`, `source`, `postedFrom`, `postedTo`, `sort`, `aiExtracted`, `page`, `pageSize`, `profileId` |
| GET | `/api/jobs/:id` | Full job (incl. `description`) for View JD. Query: `applierName`, `profileId` |
| GET | `/api/jobs/title-review/status` | Shared title-review queue counts from `athens_metadata` (temp_jobs) |
| GET | `/api/jobs/title-review` | Paginated title-review list (join metadata → **temp_jobs**). Query: `tab`, `page`, `limit`, `q`, `sort` |
| GET | `/api/jobs/title-review/bootstrap` | List + idle session counts |
| GET | `/api/jobs/skill-extract/status` | Shared skill-extract pending badge on **temp_jobs** |

- Job Search reads **`jobs` only**. Incomplete title-review / skill-extract rows live in **`temp_jobs`** and are invisible to search.
- Only `status=all` returns catalog rows today; other status tabs return an empty page (list-by-status not wired yet).
- List responses **omit** `description` (lean `select` + `@@index([postedAt])`). Unfiltered totals are cached in-process (~60s); filtered lists still `count`.
- Filters and offset pagination (`page` / `pageSize`) hit Prisma against `AthensDB.jobs`.
- With `profileId` (`account_info._id`): badge counts load from `job_status_counts` at O(1); page rows hydrate `viewerStatus` from `job_statuses` (one doc per profile × job).
- Response: `{ success, data, pagination, statusCounts, hasMore }`.

### Metadata capsule (`Job.metadata` / `TempJob.metadata`)

```text
{
  legacyId?, companyLogo?,
  details?: { location?, time?, remote?, seniority?, salary? },
  titleReview?
}
```

Legacy keys `companyTags`, `details.position`, `details.money`, and `details.date` are removed by `npm run migrate:temp-jobs`.

### Catalog split (`jobs` vs `temp_jobs`)

| Collection | Role |
|------------|------|
| `jobs` | Searchable catalog. Rows are title-approved **and** skill-pipeline done (`extracted` or `skipped_duplicate`). |
| `temp_jobs` | Staging. Title Review + Extract Skills operate here. Promote into `jobs` when both pipelines complete (`TempJobPromotionService.promoteIfReady` — AI not wired yet). |

One-shot reshape + move: `npm run migrate:temp-jobs` (add `-- --dry-run` to preview). Then rebuild queues: `npm run backfill:metadata`.

### Shared catalog queues (`athens_metadata`)

Not per-profile (unlike `job_statuses`). One membership document per `queue` × `jobId` where **`jobId` → `temp_jobs._id`**:

| Field | Values |
|-------|--------|
| `queue` | `title_review` \| `skill_extract` |
| `state` | title: `pending` \| `review_required` \| `failed`; skills: `pending` \| `failed` |
| `jobId` | `temp_jobs._id` |

Rebuild from `temp_jobs` with `npm run backfill:metadata` after `prisma:push` / `migrate:temp-jobs`.

### Profile-owned status collections

| Collection | Shape |
|------------|--------|
| `job_statuses` | One document per **profile × job** (`profileId` + `jobId` unique). Never shared across users. |
| `job_status_counts` | One document per **profile** (`profileId` unique). Status-tab badges. |

Incrementing counts when a new catalog job is ingested (touch every profile) is deferred.

Populate the job catalog with `npm run migrate:jobs` (see script header for flags). After schema changes: `npm run prisma:generate` and `npm run prisma:push`.

## Verify

```bash
npm run build
npm run lint
```
