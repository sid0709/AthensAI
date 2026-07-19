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

/** Product milestones — one entry per merge / release. Newest first. */
export const CHANGELOG_MILESTONES: ChangelogMilestone[] = [
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
    current: true,
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
