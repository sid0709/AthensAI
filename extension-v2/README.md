# AutoLancer v2 — Jobright API scraper

Chrome MV3 extension that scrapes Jobright via `swan/recommend/list/jobs` (session cookies from the Jobright tab) and POSTs jobs to Athens-server (`AthensDB.job_market`).

## Setup

```bash
cd extension-v2
npm install
npm run build
```

Load unpacked from `extension-v2/dist` (or use `npm run dev` with CRXJS).

Configure `.env`:

```
VITE_API_URL=http://127.0.0.1:8979/api
```

## Usage

1. Log into jobright.ai in Chrome.
2. Open AutoLancer v2 side panel → Scrap → Start.
3. Each processed job is marked applied on Jobright (`swan/job/apply`).

Jobs are mapped to the same POST shape as the DOM Extension. Athens-server handles ban rules, `applyLink` dedup, and enrichment (`source`, skill indexes, match/AI skill statuses). Rebuild the extension after changing `.env`.
