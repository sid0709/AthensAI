# NextOffer / AthensAI

Job search, skill matching, and resume tooling backed by **athens-backend**.

```
Public origin ──► host nginx ──► container nginx (:9030) ──► Athens SPA
/api/*          ──► athens-backend (:8980)
LLM + jobs API  ──► athens-backend (MongoDB AthensDB + Firebase Storage)
Metrics         ──► Prometheus scrape nextoffer:9101
```

## Prerequisites

| Tool | Why |
|------|-----|
| **Node.js 20+** | All services |
| **npm** | Package manager |
| **MongoDB** | AthensDB (athens-backend) |

## First-time setup

```bash
cd AthensAI

# 1. Install root workspace (packages/shared) + UI + API
npm run install:all

# 2. Copy env templates
cp athens-backend/.env.example athens-backend/.env
cp Athens/.env.example Athens/.env
# Edit athens-backend/.env — DATABASE_URL, API_KEYS_ENCRYPTION_KEY, Firebase
```

## Start everything (one command)

```bash
npm start
```

`npm start` automatically:

1. **Validates** `athens-backend/.env` (`DATABASE_URL`, encryption key)
2. **Runs** `prisma generate` and `prisma db push` (indexes / unique constraints)
3. **Launches** athens-backend (watch) and Athens UI

VPS deploys do the same `prisma db push` in `docker/entrypoint.sh` before the API starts, so production Mongo stays aligned with `schema.prisma`.

| Service | URL |
|---------|-----|
| **Frontend** | http://localhost:9030 |
| **athens-backend** | http://localhost:8980 |

Press `Ctrl+C` to stop all Node processes.

## Run services individually

```bash
npm run start:athens-backend
npm run start:ui
```

## Project layout

```
AthensAI/
├── Athens/              Frontend (React + Vite)
├── athens-backend/      NestJS + Prisma API (:8980)
├── athens-lens/         Chrome extension (Lens)
├── Extension/           Chrome extension (scraper)
├── LI-scrapper/         LinkedIn scraper extension
├── packages/shared/     Pricing, models, skill-normalize (kept forever)
├── docker/              nginx, supervisord, deploy scripts
└── monitoring/          Prometheus / Grafana
```

Legacy dirs (`Athens-server/`, `ai-bff/`, `project-avalon/`, `extension-v2-original/`) have been removed from this tree. Runtime is athens-backend only.

## Monitoring and public status

Production health is on the VPS Prometheus/Grafana/Alertmanager stack. athens-backend exposes `/metrics` (private :9101), `/healthz`, `/readyz`, and `/api/status/*`.
