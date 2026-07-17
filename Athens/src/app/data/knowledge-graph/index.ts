import { SKILL_NODES } from "./skillUniverse";

export { SKILL_NODES, SKILL_EDGES, SKILL_GRAPH } from "./skillUniverse";

/**
 * Maps free-text skill strings (as they appear on resumes) to canonical node
 * ids in the skill universe. Keys are compared after normalization
 * (lowercased, non-alphanumerics stripped except + # .).
 */
export const SKILL_ALIASES: Record<string, string> = {
  js: "javascript",
  javascript: "javascript",
  ts: "typescript",
  typescript: "typescript",
  "c#": "csharp",
  csharp: "csharp",
  ".net": "dotnet",
  dotnet: "dotnet",
  dotnetcore: "dotnet",
  "asp.net": "aspnet",
  "asp.netcore": "aspnet",
  aspnet: "aspnet",
  blazor: "blazor",
  react: "react",
  reactjs: "react",
  "next.js": "nextjs",
  nextjs: "nextjs",
  next: "nextjs",
  remix: "remix",
  vue: "vue",
  "vue.js": "vue",
  svelte: "svelte",
  angular: "angular",
  tailwind: "tailwind",
  tailwindcss: "tailwind",
  "designsystems": "design-systems",
  "node.js": "nodejs",
  nodejs: "nodejs",
  node: "nodejs",
  express: "express",
  graphql: "graphql",
  python: "python",
  django: "django",
  fastapi: "fastapi",
  pandas: "pandas",
  spark: "spark",
  pytorch: "pytorch",
  go: "go",
  golang: "go",
  rust: "rust",
  java: "java",
  spring: "spring",
  sql: "sql",
  postgresql: "postgresql",
  postgres: "postgresql",
  mysql: "mysql",
  mongodb: "mongodb",
  mongo: "mongodb",
  redis: "redis",
  neo4j: "neo4j",
  aws: "aws",
  azure: "azure",
  gcp: "gcp",
  googlecloud: "gcp",
  docker: "docker",
  kubernetes: "kubernetes",
  k8s: "kubernetes",
  "ci/cd": "cicd",
  cicd: "cicd",
  terraform: "terraform",
  performance: "performance",
  testing: "testing",
  systemdesign: "system-design",
};

export function normalizeSkillKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
}

/** Resolve a resume skill string to a node id, or null if it is not in the universe. */
export function resolveSkillId(raw: string): string | null {
  const key = normalizeSkillKey(raw);
  if (SKILL_ALIASES[key]) return SKILL_ALIASES[key];
  // Fall back to a direct id match (e.g. "frontend").
  const direct = SKILL_NODES.find((n) => normalizeSkillKey(n.id) === key || normalizeSkillKey(n.label) === key);
  return direct ? direct.id : null;
}
