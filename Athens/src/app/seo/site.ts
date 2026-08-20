import { VIEW_TITLES } from "../config/navigation";
import { PATHS, viewFromPathname } from "../config/routes";

export const SITE_NAME = "AthensAI";
export const DEFAULT_PUBLIC_ORIGIN = "https://athensai.remotepairnet.net";
export const OG_IMAGE_PATH = "/og-image.jpg";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const GOOGLE_SITE_VERIFICATION = "sYNrrjrVzwFpXv7SaJdYVuqWtdKLDwDlDWOrx6H4nZ8";
export const GTM_CONTAINER_ID = "GTM-PV6F744Q";
export const GA_MEASUREMENT_ID = "G-KBD0LLZGH1";

export const LANDING_TITLE = "AthensAI — Your career galaxy";
export const LANDING_DESCRIPTION =
  "AthensAI maps the job market, your skills, and the route to the next role worth chasing. Search, resumes, mail, and applications in one career workspace.";

export const SIGNIN_TITLE = `Sign in · ${SITE_NAME}`;
export const SIGNIN_DESCRIPTION = "Sign in to AthensAI and return to your career galaxy.";
export const SIGNUP_TITLE = `Create an account · ${SITE_NAME}`;
export const SIGNUP_DESCRIPTION = "Create an AthensAI account and start charting what comes next.";

export const PUBLIC_INDEX_PATHS = [PATHS.home, PATHS.signin, PATHS.signup] as const;

export const ROBOTS_DISALLOW = [
  PATHS.jobs,
  PATHS.titleReview,
  PATHS.resumes,
  PATHS.mail,
  PATHS.calendar,
  PATHS.notion,
  PATHS.reports,
  PATHS.aiUsage,
  PATHS.apiUsageMonitor,
  PATHS.firebase,
  PATHS.bidManagement,
  PATHS.appsPlugins,
  PATHS.changelog,
  PATHS.settings,
  "/status",
  "/api/",
  "/personal/",
  "/downloads/",
  "/healthz",
  "/readyz",
] as const;

export const INDEXABLE_ROBOTS = "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
export const PRIVATE_ROBOTS = "noindex, nofollow";

export type SeoDocument = {
  canonicalPath: string;
  title: string;
  description: string;
  robots: string;
  indexable: boolean;
};

export function normalizePath(pathname: string): string {
  const path = pathname.split("?")[0].split("#")[0] || PATHS.home;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

export function publicOrigin(runtimeOrigin?: string): string {
  const fromEnv = readEnvOrigin();
  if (fromEnv) return fromEnv;
  const runtime = (runtimeOrigin || "").replace(/\/$/, "");
  if (runtime && !isLocalOrigin(runtime)) return runtime;
  return DEFAULT_PUBLIC_ORIGIN;
}

export function absoluteUrl(path: string, origin = publicOrigin()): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalized === PATHS.home ? "/" : normalized}`;
}

export function documentForPath(pathname: string): SeoDocument {
  const path = normalizePath(pathname);
  if (path === PATHS.home) {
    return publicDoc(PATHS.home, LANDING_TITLE, LANDING_DESCRIPTION);
  }
  if (path === PATHS.signin) {
    return publicDoc(PATHS.signin, SIGNIN_TITLE, SIGNIN_DESCRIPTION);
  }
  if (path === PATHS.signup) {
    return publicDoc(PATHS.signup, SIGNUP_TITLE, SIGNUP_DESCRIPTION);
  }
  if (path === "/status") {
    return privateDoc("/status", `Status · ${SITE_NAME}`, "AthensAI production service status.");
  }
  const viewTitle = VIEW_TITLES[viewFromPathname(path)];
  return privateDoc(path, `${viewTitle} · ${SITE_NAME}`, LANDING_DESCRIPTION);
}

export function landingJsonLd(origin = publicOrigin()): Record<string, unknown> {
  const url = absoluteUrl(PATHS.home, origin);
  const image = absoluteUrl(OG_IMAGE_PATH, origin);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${url}#website`,
        name: SITE_NAME,
        url,
        description: LANDING_DESCRIPTION,
        inLanguage: "en",
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${url}#app`,
        name: SITE_NAME,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url,
        description: LANDING_DESCRIPTION,
        image,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
      },
    ],
  };
}

export function robotsTxt(origin = DEFAULT_PUBLIC_ORIGIN): string {
  const lines = [
    "User-agent: *",
    "Allow: /",
    ...ROBOTS_DISALLOW.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${absoluteUrl("/sitemap.xml", origin)}`,
    "",
  ];
  return lines.join("\n");
}

export function sitemapXml(origin = DEFAULT_PUBLIC_ORIGIN, lastmod = "2026-08-19"): string {
  const urls = PUBLIC_INDEX_PATHS.map((path) => {
    const loc = absoluteUrl(path, origin);
    const priority = path === PATHS.home ? "1.0" : "0.8";
    return [
      "  <url>",
      `    <loc>${loc}</loc>`,
      `    <lastmod>${lastmod}</lastmod>`,
      "    <changefreq>weekly</changefreq>",
      `    <priority>${priority}</priority>`,
      "  </url>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

function publicDoc(canonicalPath: string, title: string, description: string): SeoDocument {
  return { canonicalPath, title, description, robots: INDEXABLE_ROBOTS, indexable: true };
}

function privateDoc(canonicalPath: string, title: string, description: string): SeoDocument {
  return { canonicalPath, title, description, robots: PRIVATE_ROBOTS, indexable: false };
}

function readEnvOrigin(): string | null {
  try {
    const value = (import.meta as { env?: { VITE_PUBLIC_ORIGIN?: string } }).env?.VITE_PUBLIC_ORIGIN;
    const origin = String(value || "").replace(/\/$/, "");
    return origin || null;
  } catch {
    return null;
  }
}

function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  } catch {
    return true;
  }
}
