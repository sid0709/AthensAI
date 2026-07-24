# NextOffer

Job search, skill matching, and Avalon-powered auto-apply.

```
Firebase Hosting (Athens UI) ──REST──► Cloud Run (Athens API)
Athens / Agents ──Socket.IO /avalon──► Cloud Run (Avalon relay)
All LLM calls ──► ai-bff ──► OpenAI / DeepSeek
Data ──► Firestore + Cloud Storage + Algolia + Memorystore
```

## Prerequisites

| Tool | Why |
|------|-----|
| **Node.js 20+** | All services |
| **Docker Desktop** | MongoDB + Redis (easiest path) |
| **npm** | Package manager |
| **Chrome** | Avalon extension drives your real browser for auto-apply |

## First-time setup

```bash
cd NextOffer

# 1. Install dependencies (root workspaces + Athens UI + build AI BFF)
npm run install:all

# 2. Install Avalon packages (extension + shared)
cd project-avalon && npm install && cd ..

# 3. Copy env templates
cp .env.example Athens-server/.env
cp Athens/.env.example Athens/.env
cp ai-bff/.env.example ai-bff/.env
# Edit Athens-server/.env — set profile API keys in the UI under Settings → Profile
# Edit ai-bff/.env — optional env default keys for local smoke tests
```

## Start everything (one command)

**Start Docker Desktop first**, then:

```bash
npm start
```

If you use **Homebrew MongoDB + Redis** instead of Docker:

```bash
brew services start mongodb-community
brew services start redis
SKIP_DOCKER=1 npm start
```

`npm start` automatically:

1. **Starts MongoDB + Redis + Qdrant** via Docker
2. **Waits** until ports are reachable
3. **Runs `backfill-job-skills`**
4. **Builds** `ai-bff`
5. **Launches** Athens-server, ai-bff, and Athens UI

## Monitoring and public status

Production health is monitored by Google Cloud Monitoring using the load-balancer uptime check, Cloud Run revision metrics, audit logs, and billing alerts declared in [`infra/firebase/`](infra/firebase/). Athens-server still exposes `/metrics`, `/healthz`, `/readyz`, and the curated public status API under `/api/status/*`; Firestore-backed deployments report application services, Firestore, and Cloud Storage without VPS host metrics.

The Prometheus/Grafana stack in [`monitoring/`](monitoring/) is retained only for the legacy VPS and local Docker environments during migration. It is not part of the Firebase production runtime.

The production Firebase/Cloud Run deployment and Mongo/GridFS cutover procedure is in [`docs/firebase-migration-runbook.md`](docs/firebase-migration-runbook.md). The Docker stack remains the local-development path.

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:9030 |
| **Athens-server** | http://localhost:8979 |
| **AI BFF** | http://localhost:3920 |

Press `Ctrl+C` to stop all Node processes.

## Auto-apply workflow

1. Open **Agents → Controller** in Athens
2. Ensure the Avalon extension is connected (green status badge)
3. **Queue Jobs** from posted job sources, or navigate manually in Chrome
4. On a job application page: **Fetch tree** → **Analyze** → **Apply (inject)**

## Run services individually

```bash
npm run infra:up
npm run backfill-job-skills
npm run start:ai
npm run start:athens-server
npm run start:ui
cd project-avalon && npm run dev:extension    # Chrome extension
```

## Project layout

```
NextOffer/
├── Athens/              Frontend (React + Vite)
├── Athens-server/       API, matching, jobs, resumes (clustered HTTP)
├── ai-bff/              GPT + DeepSeek gateway + ai_api_usage logging
├── project-avalon/      Chrome extension + @avalon/shared + @avalon/backend (relay :3847)
└── packages/shared/     Pricing, models, skill-normalize
```

## Troubleshooting

**Relay offline** — Start the Avalon relay (`npm run start:avalon-relay` or full `npm start`). Socket.IO is on `/avalon/socket.io` (port **3847**). In Docker, nginx proxies `/avalon/` to that process.

**Extension not connected** — Load the unpacked extension from `project-avalon/packages/extension/.output/chrome-mv3` (after `npm run dev:extension`). Point `WXT_AVALON_RELAY_URL` at `http://127.0.0.1:3847` if needed.

**Best Match shows 0%** — Ensure Redis is up and backfill ran: `npm run backfill-job-skills`.

**Analyze fails** — Ensure AI keys are set under Settings → Profile (or `ai-bff/.env` for env defaults).
