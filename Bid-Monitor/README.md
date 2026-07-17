# Bid Monitor

Chrome extension for Athens **Bid Ready** apply work: silent **tab video** recording, full-page Analyze (answers + Remote / Clearance), and Submit / Skip into Bid Management.

## What it does

- **Bid Ready queue** — live jobs from Athens (`GET /vendor/tasks`); **Pending** until Apply, then **In process**
- **Apply** — opens the job tab and marks the ticket **In-Process** (`bidderInProcess`)
- **Silent video recording** — toolbar icon or context menu (no screen-share picker)
- **Analyze** — full page text + all form fields → Athens (`POST /api/job-analyze/page` + `/flags`); no character/field caps (chunked LLM when needed)
- **Submit / Skip** — stop recording (if active), update Athens Submitted or Skipped; video uploads to Firebase when present
- **Cross-tab sync** — apply state is job-scoped (survives View résumé / closing the job tab); use **Reopen job** if needed

## Install (developer mode)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder (`Bid-Monitor`)

## Bidder flow

1. Start **Athens-server** (`http://127.0.0.1:8979`).
2. In Athens → Settings → Profile: turn on **Allow vendor access** and set a **vendor access password**.
3. Open the Bid Monitor **side panel** and sign in with that profile name + vendor password (queue loads in the background).
4. Click **Apply** on a Bid Ready job → ticket becomes In process.
5. On the job tab, click the **Bid Monitor toolbar icon** (or right-click → Start recording) to start silent capture.
6. Optional: **Analyze** for suggested answers + Remote / Clearance lights (uses your Athens profile LLM key; falls back to heuristics if unavailable).
7. **Submit** (→ Submitted + upload) or **Skip this Job** (→ Skipped). Both work after Apply even without a video.

While recording on an apply tab, clicking the toolbar icon again **opens the panel** so you can choose Submit vs Skip (it does not silently stop).

## Video format

Chrome `MediaRecorder` writes **WebM (VP9)** or optional **MP4** when selected. Cap is ~720p / 15 fps for smaller reviews.

## UI

Bid Monitor follows the Athens **Bid Ready** design language (ember/teal, Figtree / Bricolage Grotesque / JetBrains Mono). Tokens live in `sidepanel/tokens.css`. See `.cursor/rules/bid-monitor-ui.mdc`.

## Project structure

```
Bid-Monitor/
├── manifest.json
├── background/              # SW, auth, queue, Athens API, page scrape
├── sidepanel/
│   ├── tokens.css           # Athens Bid Ready design tokens
│   ├── panel.html / .css / .js
│   └── …
├── popup/                   # Compact login / queue view
├── offscreen/               # MediaRecorder (MV3)
└── content/                 # Floating indicator + resume rename
```

## Permissions

- **tabCapture / offscreen** — tab video
- **scripting** — page text for Analyze
- **storage / downloads** — sessions and local video copies
