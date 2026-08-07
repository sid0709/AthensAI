export type AppPlugin = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  version: string;
  downloadUrl: string;
  iconSrc: string;
  accent: "indigo" | "teal" | "amber";
  badges: string[];
  highlights: string[];
  pairsWith?: { label: string; href: string };
};

export const APPS_CATALOG: AppPlugin[] = [
  {
    id: "athens-lens",
    name: "Athens Lens",
    tagline: "Bid Ready apply, record, and Ask AI",
    description:
      "Chrome side panel for Athens Bid Ready — apply, capture sessions, ask AI for form answers, and submit without leaving the tab.",
    version: "0.3.15",
    downloadUrl: "/downloads/athens-lens-extension.zip",
    iconSrc: "/apps/athens-lens.png",
    accent: "indigo",
    badges: ["Chrome MV3", "Developer mode", "Bid Ready"],
    highlights: [
      "Loads your live Bid Ready queue",
      "Records apply sessions as video evidence",
      "Ask AI form answers + resume rename audit",
    ],
    pairsWith: { label: "Bid Management", href: "/bid-management" },
  },
  {
    id: "extension",
    name: "Extension",
    tagline: "Job-market scraper for Athens ingest",
    description:
      "Chrome extension that scrapes job boards and posts bulk listings into Athens via /api/jobs/bulk.",
    version: "2.1.1",
    downloadUrl: "/downloads/extension.zip",
    iconSrc: "/apps/extension.png",
    accent: "teal",
    badges: ["Chrome MV3", "Developer mode", "Ingest"],
    highlights: [
      "Bulk job ingest into AthensDB",
      "Tracks scrape progress in the side panel",
      "Pairs with Job Search in Athens",
    ],
    pairsWith: { label: "Job Search", href: "/job-search" },
  },
  {
    id: "li-scrapper",
    name: "LI-scrapper",
    tagline: "LinkedIn job scrape → Athens expose API",
    description:
      "Chrome extension that collects LinkedIn job posts and sends them to Athens via /api/expose/jobs.",
    version: "1.0.0",
    downloadUrl: "/downloads/li-scrapper-extension.zip",
    iconSrc: "/apps/li-scrapper.png",
    accent: "amber",
    badges: ["Chrome MV3", "Developer mode", "LinkedIn"],
    highlights: [
      "Expose-jobs ingest path",
      "Deduped check before insert",
      "Pack-time API host baked for your VPS",
    ],
    pairsWith: { label: "Job Search", href: "/job-search" },
  },
];

export type DownloadsManifest = {
  builtAt?: string;
  extensions: Array<{
    id: string;
    name: string;
    version: string;
    file: string;
    downloadUrl: string;
  }>;
};
