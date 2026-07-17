import type { Job, JobStatus, WorkMode } from "../../types/job";
import { JobSourceTitles } from './pub';

const COMPANIES = [
  "Vercel", "Linear", "Figma", "OpenAI", "GitHub", "Stripe", "Notion", "Anthropic",
  "Meta", "Google", "Apple", "Netflix", "Airbnb", "Databricks", "Snowflake",
  "Coinbase", "Robinhood", "Plaid", "Ramp", "Brex", "Scale AI", "Hugging Face",
  "Replicate", "Supabase", "PlanetScale", "Cloudflare", "Datadog", "MongoDB", "Elastic", "HashiCorp",
];

const COMPANY_DOMAINS: Record<string, string> = {
  "Scale AI": "scale.com",
  "Hugging Face": "huggingface.co",
  "PlanetScale": "planetscale.com",
};

const TITLES = [
  "Senior Frontend Engineer", "Staff Engineer", "Engineering Lead", "ML Engineer",
  "DevOps Engineer", "Product Designer", "Backend Engineer", "Full Stack Engineer",
  "Platform Engineer", "Data Engineer", "Security Engineer", "Mobile Engineer",
  "Principal Architect", "SRE", "Frontend Engineer", "iOS Engineer",
];

const LOCATIONS = ["Remote", "San Francisco, CA", "New York, NY", "Seattle, WA", "Austin, TX", "Boston, MA"];
const SOURCES = ["LinkedIn", "Indeed", "Referral", "Direct", "Glassdoor", "Company Site"];
const STATUSES: JobStatus[] = ["posted", "applied", "scheduled", "declined"];

const INDUSTRY_SETS = [
  ["SaaS", "Developer Tools"],
  ["Fintech", "Payments"],
  ["AI/ML", "Enterprise"],
  ["Design", "Collaboration"],
  ["Cloud", "Infrastructure"],
  ["Data", "Analytics"],
  ["Security", "DevOps"],
  ["Consumer", "Mobile"],
];

const REF_DATE = new Date("2026-06-18");

function seeded(i: number, max: number) {
  return (i * 17 + 7) % max;
}

function companyDomain(company: string) {
  return COMPANY_DOMAINS[company] ?? `${company.toLowerCase().replace(/\s+/g, "")}.com`;
}

function inferSeniority(title: string): string {
  if (/principal|staff/i.test(title)) return "Staff";
  if (/lead/i.test(title)) return "Lead";
  if (/senior/i.test(title)) return "Senior";
  return "Mid-level";
}

function inferWorkMode(location: string, i: number): WorkMode {
  if (location === "Remote") return "remote";
  return seeded(i, 3) === 0 ? "hybrid" : "onsite";
}

function buildJobDescription(title: string, company: string, location: string, type: string) {
  return `${company} is hiring a ${title} (${type})${location === "Remote" ? " — remote-friendly" : ` in ${location}`}.

You'll partner with product and design to ship polished experiences, improve platform reliability, and mentor teammates as the team scales.

Requirements:
• 4+ years of relevant experience
• Strong communication and ownership
• Comfort working in fast-moving, ambiguous environments

Benefits include competitive compensation, equity, health coverage, and flexible time off.`;
}

function buildJob(i: number): Job {
  const status = STATUSES[seeded(i, STATUSES.length)];
  const daysAgo = 1 + seeded(i, 21);
  const salaryBase = 110 + seeded(i, 12) * 10;
  const company = COMPANIES[i % COMPANIES.length];
  const title = TITLES[seeded(i, TITLES.length)];
  const location = LOCATIONS[seeded(i, LOCATIONS.length)];
  const type = seeded(i, 5) === 0 ? "Contract" : "Full-time";
  const domain = companyDomain(company);

  const skill = 58 + seeded(i, 43);
  const salaryScore = 52 + seeded(i + 2, 48);
  const bidEst = 48 + seeded(i + 4, 52);
  const freshness = Math.max(5, 100 - daysAgo * 4);
  const overall = Math.round((skill + salaryScore + bidEst + freshness) / 4);

  const postedAt = new Date(REF_DATE);
  postedAt.setDate(postedAt.getDate() - daysAgo);

  return {
    id: `j${i + 1}`,
    title,
    company,
    companyUrl: `https://${domain}`,
    logoUrl: `https://logo.clearbit.com/${domain}`,
    location,
    workMode: inferWorkMode(location, i),
    type,
    seniority: inferSeniority(title),
    industries: INDUSTRY_SETS[seeded(i, INDUSTRY_SETS.length)],
    status,
    scores: {
      overall,
      skill,
      salary: salaryScore,
      bidEst,
      freshness,
    },
    matchScore: overall,
    posted: daysAgo === 1 ? "1d ago" : `${daysAgo}d ago`,
    postedAt: postedAt.toISOString().slice(0, 10),
    salary: `$${salaryBase}k–$${salaryBase + 40}k`,
    source: SOURCES[seeded(i, SOURCES.length)],
    jobDescription: buildJobDescription(title, company, location, type),
    skills: ["TypeScript", "React", "Node.js", "AWS"].slice(0, 2 + seeded(i, 3)),
    tags: seeded(i, 3) === 0 ? [`${50 + seeded(i, 150)} applicants`] : [],
    applyUrl: `https://${domain}/careers/${i + 1}`,
    skillAnalysis: i % 4 === 0
      ? { status: "analyzed", analyzedAt: postedAt.toISOString() }
      : { status: "pending" },
  };
}

export const JOBS: Job[] = Array.from({ length: 120 }, (_, i) => buildJob(i));

export const JOB_SOURCES = ["all", ...JobSourceTitles];
export const JOB_LOCATIONS = [
  "all",
  "Remote",
  "San Francisco, CA",
  "New York, NY",
  "Seattle, WA",
  "Austin, TX",
  "Boston, MA",
];
export const JOB_WORK_MODES = ["all", "remote", "hybrid", "onsite"] as const;
export const JOB_SENIORITIES = ["all", "Junior", "Mid", "Senior", "Staff", "Lead", "Principal"];
export const JOB_INDUSTRIES = [
  "all",
  "SaaS",
  "Developer Tools",
  "Fintech",
  "AI/ML",
  "Cloud",
  "Security",
  "Data",
  "Enterprise",
];
