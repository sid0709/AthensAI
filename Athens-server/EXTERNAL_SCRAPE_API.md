# External scrape ingestion API

Third-party scrapers can push job listings into Athens via a dedicated HTTP endpoint. Ingested jobs are stored in MongoDB collection **`external_scraped_jobs`** for dedupe (`jobID` / `jobLink`), and **also promoted into `job_market`**, which is the single source of truth for Job Search, Agent Queue, and skill extraction.

Base URL (local default): `http://{SERVER_IP}:8979/api`

---

## Endpoint

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/expose/jobs` | Ingest one job, or a batch via a `jobs` array |
| `POST` | `/api/expose/jobs/check` | Check whether a `jobID` already exists |

Route wiring:

- `src/routes/scrapedJobIngestRoutes.js` — mounts `POST /expose/jobs` and `POST /expose/jobs/check` under `/api`
- `index.js` — `app.use('/api', scrapedJobIngestRoutes)`

---

## Request body

### Single job

Send a JSON object with the fields below.

```bash
curl -X POST http://{SERVER_IP}/api/expose/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "my-scraper-v1",
    "jobID": "linkedin-12345678",
    "companyName": "Acme Corp",
    "companyIcon": "https://example.com/logo.png",
    "jobTitle": "Senior Engineer",
    "jobDescription": "Full job description text…",
    "jobLink": "https://boards.greenhouse.io/acme/jobs/123",
    "postedAgo": "2 days ago"
  }'
```

### Batch

Send `{ "jobs": [ … ] }`. Each element uses the same shape as a single job. The array must not be empty.

---

## Fields

| Field | Required | Aliases | Notes |
|-------|----------|---------|-------|
| `sender` | yes | `Sender` | Identifies the integrator / scraper (provenance only) |
| `jobID` | yes | `job_id`, `jobId` | Vendor-stable job identifier; used for existence checks |
| `companyName` | yes | `company_name` | |
| `jobTitle` | yes | `job_title`, `title` | |
| `jobDescription` | yes | `job_description`, `description` | |
| `jobLink` | yes | `job_link`, `applyLink`, `url` | Must be a valid `http://` or `https://` URL; also used to derive `source` |
| `companyIcon` | no | `company_icon` | If present, must be a valid `http(s)` URL |
| `source` | no | — | **Ignored.** Board/ATS label is derived from `jobLink` via `inferJobSource` (e.g. Greenhouse, Workable, LinkedIn, Other) |
| `postedAgo` | no | `posted_ago`, `postedAt` | Human-readable relative posting time (e.g. `"8 months ago"`) |

Validation lives in `src/services/scrapedJobIngestService.js` (`validateScrapedJobInput`). Promotion into `job_market` lives in `src/services/promoteExternalJobToMarket.js`.

---

## Responses

### Single job — created (201)

```json
{
  "success": true,
  "created": true,
  "id": "<mongodb ObjectId>",
  "jobID": "linkedin-12345678",
  "jobLink": "https://boards.greenhouse.io/acme/jobs/123",
  "source": "Greenhouse",
  "marketId": "<job_market ObjectId>"
}
```

### Single job — duplicate (200)

Duplicates are detected by unique indexes on `jobID` and `jobLink` in `external_scraped_jobs`. No new document is inserted (and `job_market` is not written again).

```json
{
  "success": true,
  "created": false,
  "duplicate": true,
  "jobID": "linkedin-12345678",
  "jobLink": "https://boards.greenhouse.io/acme/jobs/123"
}
```

### Batch — mixed results (201)

```json
{
  "success": true,
  "created": 2,
  "duplicates": 1,
  "results": [
    { "created": true, "id": "…", "jobID": "…", "jobLink": "…", "source": "Greenhouse", "marketId": "…" },
    { "created": false, "duplicate": true, "jobID": "…", "jobLink": "…" }
  ]
}
```

### Validation error (400)

```json
{
  "success": false,
  "error": "jobTitle is required"
}
```

For batch requests, errors include the array index: `jobs[2]: jobLink must be a valid http(s) URL`.

### Server error (500)

```json
{
  "success": false,
  "error": "<message>"
}
```

---

## Check job existence

`POST /api/expose/jobs/check`

```bash
curl -X POST http://{SERVER_IP}/api/expose/jobs/check \
  -H "Content-Type: application/json" \
  -d '{ "jobID": "linkedin-12345678" }'
```

### Exists (200)

```json
{
  "success": true,
  "exists": true
}
```

### Not found (200)

```json
{
  "success": true,
  "exists": false
}
```

### Validation error (400)

```json
{
  "success": false,
  "error": "jobID is required"
}
```

---

## Storage (MongoDB)

### `external_scraped_jobs` (dedupe / provenance)

Each document stores the normalized job fields (`sender`, `jobID`, `companyName`, `companyIcon`, `jobTitle`, `jobDescription`, `jobLink`, `postedAgo`) plus:

- `source` / `sourceVersion` — derived from `jobLink` (not from the request body)
- `createdAt` / `updatedAt`
- After successful promote into `job_market`, `aiSkillStatus` is set to `skipped_duplicate` so skill extraction does not run on this catalog

Indexes:

| Index | Purpose |
|-------|---------|
| `{ jobLink: 1 }` unique (partial: string only) | Dedupe by apply URL |
| `{ jobID: 1 }` unique (partial: string only) | Dedupe by vendor job ID; fast existence checks |
| `{ createdAt: -1 }` | Recent-first listing |
| `{ sender: 1, createdAt: -1 }` | Filter by integrator |
| `{ source: 1, createdAt: -1 }` | Filter by derived source |

### `job_market` (single source of truth)

On create (when `applyLink` is not already present), a market document is inserted with the standard market shape, `source` from `inferJobSource(applyLink)`, and `externalRef: { sender, jobID, id }` for provenance.

Historical backfill runs automatically on server start (`initMongo`). Manual / dry-run: `node src/scripts/migrateExternalScrapedJobsToMarket.js [--dry-run]`

---

## Code map

| File | Role |
|------|------|
| `src/routes/scrapedJobIngestRoutes.js` | Express route |
| `src/controllers/scrapedJobIngestController.js` | HTTP handlers (`postExternalScrapedJob`, `postCheckExternalScrapedJobExists`) |
| `src/services/scrapedJobIngestService.js` | Validation + insert / dedupe + promote |
| `src/services/promoteExternalJobToMarket.js` | Map external → market + promote helper |
| `src/scripts/migrateExternalScrapedJobsToMarket.js` | One-time / idempotent historical migration |
| `src/db/mongo.js` | Collection + indexes |
