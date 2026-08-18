export type ChangelogMilestone = {
  id: string;
  version: string;
  title: string;
  date: string; // ISO date YYYY-MM-DD
  merge: string;
  branch?: string;
  summary: string;
  tags: string[];
  changes: string[];
  current?: boolean;
};

/** Product milestones — one entry per merge / release. Newest first. Never list Oak. */
export const CHANGELOG_MILESTONES: ChangelogMilestone[] = [
  {
    id: "lens-chrome-titles-resumes",
    version: "0.17.0",
    title: "Review Titles and Resumes chrome",
    date: "2026-08-18",
    merge: "main",
    branch: "main",
    summary:
      "Review Titles and My Resumes use the same quiet toolbar, tabs, and black actions as Job Search.",
    tags: ["Review Titles", "Resumes"],
    current: true,
    changes: [
      "Review Titles uses one Lens toolbar: tabs, search, and black Start review / Approve actions",
      "My Resumes keeps Library, Editor, History, and Analysis on one toolbar with Generate",
      "The resume editor puts System instruction next to Generate and hides the workflow and identity cards",
      "The resume library puts Uploaded/Generated next to search and upload, and selection tools only when needed",
    ],
  },
  {
    id: "status-process-memory",
    version: "0.16.0",
    title: "Host vs app memory",
    date: "2026-08-18",
    merge: "main",
    branch: "main",
    summary:
      "The status page splits whole-VPS memory into Athens, MongoDB, monitoring, and other so idle RAM can be attributed.",
    tags: ["Status"],
    changes: [
      "Live telemetry keeps host CPU, memory, and disk, then adds a RAM breakdown for Athens, MongoDB, monitoring, and everything else",
      "Each slice is a share of host RAM, with size in GiB when the host total is known",
    ],
  },
  {
    id: "vps-memory",
    version: "0.15.0",
    title: "VPS memory",
    date: "2026-08-17",
    merge: "main",
    branch: "main",
    summary:
      "Keep Job Search and Mail stable instead of the host filling RAM a few hours after a restart.",
    tags: ["Job Search", "Mail"],
    changes: [
      "Job Search company cards send only the jobs on the page, not every role id at that company",
      "Mail sync reads a bounded page of new messages, and folder badges no longer load every unread id",
    ],
  },
  {
    id: "resume-word-filename",
    version: "0.14.0",
    title: "Word file name",
    date: "2026-08-17",
    merge: "main",
    branch: "main",
    summary:
      "Word downloads keep the candidate’s full name, including spaces, as in John Doe.docx.",
    tags: ["Resumes"],
    changes: [
      "Generate and History Word files use the full name as-is, such as John Doe.docx",
    ],
  },
  {
    id: "resume-preview-draft",
    version: "0.13.0",
    title: "Resume draft in preview",
    date: "2026-08-17",
    merge: "main",
    branch: "main",
    summary:
      "Keep the generated résumé in the live preview when a run fails after the model steps finish.",
    tags: ["Resumes"],
    changes: [
      "Summary, Skills, and Experience land in the preview as each final step completes",
      "If saving the run fails, the draft stays visible instead of falling back to placeholder text",
    ],
  },
  {
    id: "resume-american-dates",
    version: "0.12.0",
    title: "Resume dates",
    date: "2026-08-17",
    merge: "main",
    branch: "main",
    summary:
      "Show experience and education dates as Apr 2022 instead of 2022.4, including Word downloads.",
    tags: ["Resumes"],
    changes: [
      "Role and school dates use American month-year labels such as Apr 2022",
      "Word downloads use the same date labels as the résumé preview",
    ],
  },
  {
    id: "settings-layout",
    version: "0.11.0",
    title: "Settings layout",
    date: "2026-08-17",
    merge: "main · settings-ui",
    branch: "main",
    summary:
      "Tighten Settings chrome: theme lives on the tab bar as icon-only controls, and section headers are no longer extra cards.",
    tags: ["Settings"],
    changes: [
      "Light, System, and Dark sit as compact icons on the Settings tab bar",
      "Profile, Notifications, and Security titles sit as a heading row instead of a second boxed toolbar",
      "Notification preferences are one list instead of a card per toggle",
      "The LinkedIn résumé reminder is a highlighted notice under Auto-bid profile, with Update résumés as a text action",
    ],
  },
  {
    id: "job-search-home",
    version: "0.10.0",
    title: "Job Search is home",
    date: "2026-08-17",
    merge: "main",
    branch: "main",
    summary:
      "Drop the unused Dashboard and open Job Search after sign-in, from the logo, and for unknown URLs.",
    tags: ["Job Search", "Navigation"],
    changes: [
      "Dashboard is gone from the sidebar; Job Search is the first workspace page",
      "Signing in, the AthensAI logo, and unknown URLs now open Job Search",
      "Beta and admin lock screens link back to Job Search instead of Dashboard",
    ],
  },
  {
    id: "settings-lens",
    version: "0.9.0",
    title: "Settings, Lens chrome",
    date: "2026-08-17",
    merge: "main · settings-ui",
    branch: "main",
    summary:
      "Bring Settings onto the same quiet Lens chrome as Job Search — system sans, 1px borders, and flat cards instead of pill tabs and primary buttons.",
    tags: ["Settings"],
    changes: [
      "Profile, Notifications, Integrations, and Security share the Job Search toolbar and tab chrome",
      "Forms, switches, and dialogs use the same quiet cards and control styling as Job Search",
      "Account deletion and vendor access stay in place with a calmer danger zone",
    ],
  },
  {
    id: "analytics-lens",
    version: "0.8.0",
    title: "Analytics, Lens chrome",
    date: "2026-08-17",
    merge: "main · analytics-ui",
    branch: "main",
    summary:
      "Bring Job Search Analytics onto the same quiet Lens chrome as Job Search, with real time-range and source filters.",
    tags: ["Analytics", "Job Search"],
    changes: [
      "Analytics uses the Job Search toolbar, tabs, and filter sheet instead of pill tabs and colored KPI cards",
      "Time presets now include 7 days, 30 days, 90 days, year to date, all time, and a custom from/to range",
      "Source filters, shareable URL state, and previous-period deltas sit on the same metrics",
      "Postings chart is a quiet daily total; click a source to overlay it in blue, with conversion and Job Search links in the list",
    ],
  },
  {
    id: "mail-ai-label",
    version: "0.7.0",
    title: "Mail AI Label",
    date: "2026-08-17",
    merge: "main · mail-ai-label",
    branch: "main",
    summary:
      "Save custom Gmail label definitions reliably, then classify inbox mail in parallel from truncated body text instead of full messages.",
    tags: ["Mail", "AI Label"],
    changes: [
      "Label definitions persist on standalone Mongo without a replica-set transaction error",
      "Analyze classifies many emails per AI request, with concurrent batches instead of one-by-one calls",
      "Requests send sender, subject, and truncated plain-text body — not full MIME or attachments",
      "Gmail label writes are grouped by mailbox and label, and the dialog reports real AI and write metrics",
      "Changelog uses the same Athens Lens chrome as Job Search — system sans, quiet cards, and a 1px border",
    ],
  },
  {
    id: "worker-pool-and-recommend",
    version: "0.6.0",
    title: "Worker Pool & Recommend",
    date: "2026-08-14",
    merge: "main · worker-pool / applied-fix",
    branch: "main",
    summary:
      "Move jobs through Worker Pool and Bid Ready with explicit resume recommendation, company-wide apply, and a faster analysis pass.",
    tags: ["Job Search", "Worker Pool", "Recommend"],
    changes: [
      "Worker Pool sits alongside Bid Ready so pooled jobs keep a durable status without breaking Posted cards",
      "Recommend resumes for New jobs after choosing Bid Ready or Worker Pool in a confirmation modal",
      "Apply all company roles can continue to the next posting when a library resume does not fit, with auto-swap on or off",
      "Applied marking, company-role apply, and Job Search cards, pagination, and typography are more consistent",
      "Job analysis runs in larger parallel batches so ranking and recommend catch up faster",
    ],
  },
  {
    id: "job-search-at-scale",
    version: "0.5.0",
    title: "Job Search at Scale",
    date: "2026-07-29",
    merge: "main · Job Search v2",
    branch: "main",
    summary:
      "Turn Job Search into a fast, resilient career command center for exploring, ranking, and managing thousands of opportunities.",
    tags: ["Job Search", "Personalization", "Reliability"],
    changes: [
      "Company-grouped results keep related roles together, with expandable role trays and focused-job deep links",
      "Shareable URL state preserves filters, sorting, pagination, view mode, expanded company, and focused role",
      "A compact Qdrant-backed read model ranks roughly 15,000 jobs with per-profile skill coverage and fast source facets",
      "Durable per-profile status projections power exact Applied, Scheduled, Declined, Bid Ready, and Bid Completed workflows",
      "Bulk status actions, bulk scraper ingest, stronger identity deduplication, and deterministic result reconciliation",
      "Automatic Firestore-to-ranking reconciliation removes orphaned cards before users can act on deleted jobs",
      "API readiness no longer waits for every profile ranking to rebuild; cache and index maintenance continue safely in the background",
      "Conservative title review quarantines ambiguous roles while keeping Job Search indexes synchronized",
      "Stable company-keyed card measurements eliminate intermittent blank gaps after expanding, filtering, or updating jobs",
      "Expanded regression coverage for Job Search, status transitions, Firestore compatibility, ranking indexes, and cache repair",
    ],
  },
  {
    id: "session-based-bid-recording",
    version: "0.4.0",
    title: "Session-based Bid Recording",
    date: "2026-07-19",
    merge: "bid-management-update",
    branch: "bid-management-update",
    summary:
      "Keep one complete recording per job application, even when bidders move through verification links and multiple tabs.",
    tags: ["Bid Monitor", "Recording", "Chrome Extension"],
    changes: [
      "Application sessions group multiple tab recordings under the same Bid Ready job",
      "Side-panel Start/Stop plus toolbar-icon capture (Chrome requires toolbar invoke for tab recording)",
      "Child application tabs are matched automatically, while uncertain verification clips ask the bidder where they belong",
      "Closing a manually recorded unrelated tab reliably asks which active application should receive the clip",
      "Waiting clips stay visible across tabs via a panel card, toolbar badge, and Chrome notification",
      "Zero-byte captures show a dismissible notice instead of disappearing silently",
      "New active-applications view shows recording status, clip count, open tabs, warnings, and finish actions",
      "Merged clips are re-encoded chronologically into one playable video before upload",
      "Session and segment metadata survive panel closure and extension reloads with guided recording recovery",
      "Parallel applications and multiple Workday jobs remain isolated without silent cross-job merges",
    ],
  },
  {
    id: "apps-plugins",
    version: "0.3.0",
    title: "Apps & Plugins",
    date: "2026-07-19",
    merge: "add-plugins",
    branch: "add-plugins",
    summary:
      "Ship Chrome extension packs with every deploy, plus safer endpoint wiring so builds never embed plaintext API URLs.",
    tags: ["Extensions", "Docker", "Security"],
    changes: [
      "New Apps & Plugins page to download Bid Monitor and Project Avalon zips from the VPS deploy",
      "Docker pack pipeline builds extension archives and Nginx serves them under /downloads",
      "ATHENS_API_URL encoded into extension builds — no plaintext host/URL in packed artifacts",
      "Extension health checks and errors redact sensitive host/IP/URL details in the UI",
      "Bid Monitor env apply script and Avalon endpoint helpers for reliable Athens API pairing",
    ],
  },
  {
    id: "vendor-management",
    version: "0.2.0",
    title: "Vendor Management",
    date: "2026-07-19",
    merge: "PR #1 · vender-management",
    branch: "vender-management",
    summary:
      "Split Avalon into its own backend process and harden resume generation with clearer progress, concurrency, and PDF rendering.",
    tags: ["Avalon", "Resumes", "Infra"],
    changes: [
      "Avalon relay moved to a dedicated @avalon/backend service on port 3847",
      "Docker, Nginx, and supervisord updated for the new Avalon process and health checks",
      "Resume generation: better progress tracking, optional PDF, and concurrency raised to 12",
      "PDF render pool/worker for more reliable agent resume PDFs",
      "Job URL linking in Job Search, with clearer resume-generation error handling",
    ],
  },
  {
    id: "initial-release",
    version: "0.1.0",
    title: "Initial Release",
    date: "2026-07-17",
    merge: "Initialize",
    summary:
      "First ship of the Athens career platform — web app, API, agents, bid tooling, and the deploy stack.",
    tags: ["Foundation", "Platform"],
    changes: [
      "Athens web app: Job Search, Resumes, Agents, Mail, Bid Management, Settings, and admin usage views",
      "Athens-server API with auth, resume generation, bid review, mail, and AI usage tracking",
      "Project Avalon and Bid Monitor Chrome extension foundations",
      "Docker + Nginx + GitHub Actions publish pipeline for VPS deploys",
      "Firebase explorer, reports scaffolding, and environment configuration templates",
    ],
  },
];

/** Most recent milestone date — shown as “Last updated” on the Changelog page. */
export const CHANGELOG_LAST_UPDATED = CHANGELOG_MILESTONES[0]?.date ?? "2026-07-19";
