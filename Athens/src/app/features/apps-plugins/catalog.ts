export type AppPlugin = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  version: string;
  downloadUrl: string;
  iconSrc: string;
  accent: "indigo" | "teal";
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
    id: "avalon",
    name: "Project Avalon",
    tagline: "Remote browser control for auto-apply",
    description:
      "Relay-powered Chrome extension that lets Athens Agents scan, analyze, and inject applications through your real browser session.",
    version: "0.1.0",
    downloadUrl: "/downloads/avalon-extension.zip",
    iconSrc: "/apps/avalon.png",
    accent: "teal",
    badges: ["Chrome MV3", "Developer mode", "Agents"],
    highlights: [
      "Pairs with Avalon Controller in Agents",
      "Keeps your logged-in browser session",
      "Relay health + profile sign-in built in",
    ],
    pairsWith: { label: "Agents", href: "/agents" },
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
