# Athens-server

Backend for **Athens** (NextOffer job search, resume analysis, skill graph, and multi-vector job recommendations). Default API base: `http://127.0.0.1:8979/api`.

## Features

- **Job market** — ingest, list, filter, and sort jobs (`POST /api/jobs/list`)
- **Multi-vector job recommendations** — per-applier ranking from analyzed resumes (not a single global profile score)
- **Resume upload & analysis** — LLM skill extraction, per-resume knowledge graphs
- **Skill knowledge graph** — Neo4j world graph + Firestore user graphs; graph boost during ranking
- **Real-time** — Socket.io for extension / frontend events
- **Mail, accounts, rules, FoxHire integration** — see routes under `src/routes/`
- **Athens Lens API** — vendor-password sessions and the authenticated Bid Ready job feed

## Athens Lens API

Athens Lens uses a separate session boundary from Firebase owner auth:

- `POST /api/athens-lens/auth/signin` with `{ "username", "password" }` validates the profile username, `vendorAllowed`, and the bcrypt vendor access password. It returns an opaque expiring bearer session.
- `GET /api/athens-lens/jobs` with `Authorization: Bearer <token>` returns only that session profile's current Bid Ready jobs.
- `GET /api/athens-lens/gmail/messages` reads only recent Gmail envelopes and flags through the profile's stored Google app password so the inbox list can render without waiting for message downloads.
- `GET /api/athens-lens/gmail/message-bodies?ids=<uid,...>` fetches bounded, decoded MIME text parts concurrently across pooled IMAP connections—without downloading attachments—and returns safe text content plus detected verification codes.
- `POST /api/athens-lens/auth/signout` with the same bearer token revokes the Redis session.

No Athens Lens endpoint accepts an applier name from the client. Set `ATHENS_LENS_SESSION_TTL_SECONDS` to override the default 12-hour lifetime.

## Stack

| Service | Purpose |
|---------|---------|
| **Firestore** | Jobs, resumes, accounts, user knowledge graphs |
| **Neo4j** | Shared skill ontology (enrichment, graph re-rank) |
| **Neo4j GDS** | Weighted path scoring (Dijkstra) + link prediction for missing edges |
| **Qdrant** | Vector index for job + resume embeddings |
| **Ollama** | Local embeddings (`mxbai-embed-large`, no API key) |
| **Node.js + Express** | HTTP API and background workers |

## Job recommendation (overview)

### Query-time sparse ranking (v2)

The scalable path is opt-in with `RECOMMENDATION_QUERY_TIME_MODE=on`. It stores one
canonical weighted sparse vector per job in the `jobs_active` Qdrant alias,
retrieves a bounded candidate set for the current user's manual skills, and
exact-reranks those candidates with the existing coverage scorer. Redis caches
only active query results using profile, dictionary, and catalog revisions; it
does not materialize user-job score rows.

Initial migration:

```bash
npm run infra:up --prefix ..
npm run backfill-query-ranking
# Rebuild only job payloads/vectors after a card schema change:
npm run backfill-query-ranking -- --skip-dictionary
npm run test:query-ranking
# Sample the new path while users still receive legacy results.
RECOMMENDATION_QUERY_TIME_MODE=shadow
# Run an exhaustive accuracy check for representative 100/250/500-skill profiles.
npm run validate-query-ranking -- --applier="Profile name"
# Against the 1M-job performance dataset, repeat for 100, 250, and 500 skills.
npm run benchmark-query-ranking -- --applier="Profile name" --expected-skills=100
# Enable only after recall@100 and NDCG@100 pass the rollout thresholds.
RECOMMENDATION_QUERY_TIME_MODE=on
```

New and re-extracted jobs are dual-written to the v2 index. When the flag is
enabled, the legacy full-catalog score worker is disabled; Qdrant/Redis failures
return a newest-first result marked with `rankingStatus: fallback` and are never
reported as fresh v2 rankings.

Keep the legacy score rows and the ability to switch the mode back to `off` for
seven days after cutover; remove them only after the shadow and live metrics stay healthy.

### Legacy recommendation path

Each applier can have **multiple analyzed resumes** (e.g. Frontend vs Backend). Each resume gets its own embedding in Qdrant.

When Job Search uses **Best match** (`sort=recommended`):

1. Load analyzed resume + profile vectors for the applier (cached ~3 min)
2. **Qdrant ring pagination** — fetch only the current page via vector similarity boundaries (`scoreAtRank`), not a full-catalog re-rank
3. Apply Firestore-compatible filters on the page’s job IDs (status tab, title, company, etc.)
4. Optional Neo4j graph boost on **the vector candidate pool** using GDS weighted paths (falls back to Cypher if GDS plugin missing)
5. Return jobs with `matchScore`, `scoreSkill`, `bestResumeTechStack`, etc.

Job vectors store `source` and `postedAt` in Qdrant payload for pre-filtering. Status-tab filters use a bounded Firestore-compatible `$in` on hydrated page IDs.

If Qdrant, Ollama, or analyzed resumes are missing, the API falls back to newest-first and sets `recommendationFallback: true`.

See [`idea.md`](../idea.md) in the repo root for the full design.

---

## Prerequisites

- **Node.js** 18+ and npm
- **Firebase** project with Firestore, Cloud Storage, and Admin SDK credentials
- **Redis** for cache and background queues
- **Neo4j** (skill graph enrichment) — install **Graph Data Science** plugin for best path scoring
- **Qdrant** (vector search) — Docker or binary
- **Ollama** (embeddings) — [native macOS app](https://ollama.com) or Docker

---

## Quick start

### 1. Install dependencies

```bash
cd Athens-server
npm install
cp .env.example .env
# Edit .env — at minimum FIREBASE_*, GOOGLE_APPLICATION_CREDENTIALS,
# NEO4J_*, REDIS_URL, QDRANT_URL, and Ollama settings
```

### 2. Ollama (embeddings)

**Recommended on macOS:** install the [Ollama app](https://ollama.com) (no Docker required).

```bash
# Pull the embedding model once (~670MB)
npm run ollama-pull-embed
# or: ollama pull mxbai-embed-large

# Verify
ollama list
curl http://127.0.0.1:11434/api/tags
```

**Alternative:** Docker (requires Docker Desktop running):

```bash
docker compose up -d ollama
docker compose exec ollama ollama pull mxbai-embed-large
```

Default env (no API key):

```env
EMBEDDING_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
EMBEDDING_MODEL=mxbai-embed-large
EMBEDDING_DIMENSIONS=1024
```

`mxbai-embed-large` uses asymmetric retrieval: **jobs** are embedded as documents; **resumes** use a query prefix for better search quality. Inputs are truncated to ~1800 characters (`EMBEDDING_MAX_INPUT_CHARS`) because the model has a 512-token context window.

### 3. Qdrant (vector store)

Qdrant runs as a **Docker service** on `http://127.0.0.1:6333` (dashboard: `/dashboard`). Data persists in the Docker volume `qdrant_storage` — not in the repo.

```bash
cd Athens-server
npm run qdrant:start    # docker compose up -d qdrant
npm run qdrant:stop
```

```env
QDRANT_URL=http://127.0.0.1:6333
```

**Important:** Do not run the old embedded binary (`npm run qdrant:start-native`) at the same time — both bind port 6333. Only one Qdrant instance should be active.

Collections `job_vectors` and `resume_vectors` are created automatically when Athens-server starts (1024 dimensions with default Ollama settings).

### 3b. Neo4j + GDS (skill graph path scoring)

For weighted path scoring and automatic link prediction, use Neo4j with the **Graph Data Science** plugin:

```bash
docker compose up -d neo4j
# Browser: http://127.0.0.1:7474 — login neo4j / skillgraph-dev (or your NEO4J_PASSWORD)
# Verify GDS: RETURN gds.version();
```

Or install GDS on an existing Neo4j Desktop / server instance. See [Neo4j GDS installation](https://neo4j.com/docs/graph-data-science/current/installation/).

Without GDS, path scoring falls back to weighted Cypher (`KG_GDS_FALLBACK_TO_CYPHER=true`).

**Background maintenance** (enabled by default) drains the pending skill queue, syncs co-occurrence pairs, and runs link prediction on an interval. One-time catch-up for existing data:

```bash
npm run backfill-graph-bridges
npm run backfill-graph-bridges -- --link-prediction
```

### 4. Backfill embeddings

After Ollama and Qdrant are up, embed existing jobs and analyzed resumes:

```bash
npm run backfill-job-embeddings
npm run backfill-resume-embeddings
```

New jobs and newly analyzed resumes are embedded automatically in the background.

### 5. Start the server

```bash
npm start
```

On startup you should see logs for Firestore, Redis, Neo4j, Qdrant collections, and Ollama model readiness.

---

## Environment variables

Copy from [`.env.example`](.env.example). Key groups:

| Variable | Description |
|----------|-------------|
| `PORT`, `HOST` | HTTP server (default `8979`) |
| `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `GOOGLE_APPLICATION_CREDENTIALS` | Firestore and Cloud Storage runtime |
| `REDIS_URL` | Cache, queues, and cluster coordination |
| `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` | Skill graph |
| `QDRANT_URL` | Vector database |
| `EMBEDDING_PROVIDER` | `ollama` (default) or `openai` |
| `OLLAMA_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | Local embeddings |
| `RECOMMENDATION_VECTOR_TOP_K`, `RECOMMENDATION_CANDIDATE_POOL` | Retrieval tuning |
| `NEO4J_GDS_GRAPH_NAME`, `KG_LINK_PREDICTION_MIN_SCORE`, `KG_PATH_HOP_DECAY` | GDS path scoring + link prediction |
| `SKILL_GRAPH_MAINTENANCE_*`, `SKILL_GRAPH_BRIDGE_LLM_ENABLED` | Background graph completion |
| `RESUME_GEN_GLOBAL_CONCURRENCY` | Max in-flight résumé gens process-wide (default **32**) |
| `RESUME_GEN_PER_USER_CONCURRENCY` | Max in-flight résumé gens per applier (default **12**) |
| `PDF_RENDER_CONCURRENCY` | Max concurrent PDF renders (default **16**) |
| `PUPPETEER_BROWSER_POOL` | Chromium processes for PDF (default **6**) |
| `LLM_GLOBAL_CONCURRENCY` | Priority admission cap for all LLM calls (default **48**) |
| `MAIL_AI_LABEL_CONCURRENCY` | Parallel AI-label metadata and rare body-fallback preparation (default **8**) |
| `MAIL_AI_LABEL_AI_CONCURRENCY`, `MAIL_AI_LABEL_GMAIL_CONCURRENCY` | Parallel AI batches (default **8**) and grouped Gmail label writes (default **3**) |
| `MAIL_AI_LABEL_SNIPPET_MAX_CHARS`, `MAIL_AI_LABEL_SNIPPET_MAX_BYTES` | Hybrid first-pass text and IMAP download limits (defaults **1000 chars / 2048 bytes**) |
| `MAIL_AI_LABEL_BODY_MAX_CHARS`, `MAIL_AI_LABEL_BODY_FETCH_MAX_BYTES` | Uncertain-message fallback prompt and IMAP download limits (defaults **4000 chars / 16384 bytes**) |
| `IMAP_MAX_CONNS_PER_ACCOUNT` | IMAP pool size per Gmail account (default **8**) |
| `MAIL_UNLABELED_SCAN_BATCH_SIZE`, `MAIL_UNLABELED_SCAN_CONCURRENCY` | Exact Gmail label metadata scan batch size (**2000**) and parallelism (**8**) |
| `JOB_SKILL_EXTRACT_CONCURRENCY` | Skill-extract fan-out (default **16**) |

All KG tunables are documented in [`.env.example`](.env.example) and loaded via `src/config/graphAndVectorConfig.js`.

**Optional OpenAI embeddings** (requires `openaiApiKey` in `account_info.autoBidProfile`):

```env
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

Switching embedding provider or dimensions requires **re-backfilling** all vectors. If you change dimensions, reset the Qdrant volume or delete collections before re-backfilling.

---

## NPM scripts

| Script | Description |
|--------|-------------|
| `npm start` | Dev server (nodemon) |
| `npm run qdrant:start` | Start Qdrant via Docker on `:6333` |
| `npm run qdrant:stop` | Stop Docker Qdrant |
| `npm run qdrant:start-native` | Legacy embedded binary (`.local/qdrant/`) |
| `npm run backfill-job-embeddings` | Embed all jobs into Qdrant |
| `npm run backfill-resume-embeddings` | Embed all analyzed resumes into Qdrant |
| `npm run reset-skill-graph` | Reset Neo4j skill graph (destructive) |
| `npm run backfill-graph-bridges` | Drain pending queue + co-oc backfill + GDS refresh |

---

## Recommendation-related API

| Method | Path | Notes |
|--------|------|--------|
| `POST` | `/api/jobs/list` | Body: `sort: "recommended"`, `applierName`, filters. Returns ranked jobs. |
| `POST` | `/api/personal/user-resumes/:id/analyze` | Extract skills + upsert resume embedding |
| `POST` | `/api/jobs` | Create job + async job embedding |
| `GET` | `/api/user-graph` | Per-resume / profile knowledge graphs |

Frontend (Athens) maps **Best match** sort to `sort=recommended` and sends the current applier name.

---

## Project layout

```
Athens-server/
├── index.js                 # Entry: Express, Socket.io, workers
├── docker-compose.yml       # Qdrant + Ollama (optional)
├── src/
│   ├── controllers/         # HTTP handlers
│   ├── routes/
│   ├── services/
│   │   ├── embeddings/      # Ollama/OpenAI embed + ingest
│   │   ├── vectorStore/     # Qdrant client
│   │   ├── recommendation/  # Multi-vector search + graph re-rank
│   │   ├── skillGraph/      # Neo4j world graph
│   │   ├── userKnowledgeGraph/
│   │   └── jobAnalysis/
│   └── scripts/             # Backfill & maintenance
└── .env.example
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `docker.sock: connect: no such file` | Start Docker Desktop, then `npm run qdrant:start` from **Athens-server/**. |
| `no configuration file provided: not found` | Run `docker compose` from **Athens-server/** (where `docker-compose.yml` lives), not the repo root. |
| `[embeddings] Ollama not ready` | Start Ollama app or run `ollama serve`; then `npm run ollama-pull-embed`. |
| `[qdrant] QDRANT_URL not set` | Set `QDRANT_URL` and start Qdrant (`npm run qdrant:start` or Docker). |
| `[qdrant] init failed: fetch failed` (but curl works) | Restart Athens-server after Qdrant is up. Confirm: `curl http://127.0.0.1:6333/collections` |
| Qdrant dashboard shows no collections | Wrong instance on `:6333` — stop native (`npm run qdrant:stop-native`) and use Docker (`npm run qdrant:start`). Restart Athens-server to create collections. |
| Job Search shows fallback banner | Analyze at least one resume; run both backfill scripts; confirm Qdrant + Ollama. |
| Wrong vector dimension errors | Model/dimension changed — reset Qdrant data and re-run backfills. |
| Neo4j errors | Check `NEO4J_*` in `.env`; skill enrichment disabled until Neo4j is up unless `NEO4J_REQUIRED=true`. |

---

## Docker Compose

[`docker-compose.yml`](docker-compose.yml) defines **Neo4j (GDS)**, **Qdrant**, and **Ollama**. You can run services alone:

```bash
docker compose up -d neo4j           # skill graph + GDS
docker compose up -d qdrant          # vectors only
docker compose up -d ollama          # embeddings only (if not using native Ollama)
docker compose up -d                 # all
```

Native Ollama on macOS is usually simpler than running Ollama in Docker.
