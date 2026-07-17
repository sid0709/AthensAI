const SCORE_LINE = /^(.+?)\s+[█#\-*=.\u2588\u2593\u2592\u2591\s]+\s*(\d{1,2})\s*$/;
const SIMPLE_LINE = /^(.+?)\s+(\d{1,2})\s*$/;
const COLON_LINE = /^(.+?):\s*(\d{1,2})\s*$/;

/** Canonical title token → matching aliases found in JD skill names. */
const TITLE_ALIASES = {
  ai: [
    "ai",
    "artificial intelligence",
    "llm",
    "llms",
    "rag",
    "agentic",
    "generative",
    "openai",
    "chatgpt",
    "bedrock",
    "sagemaker",
    "embeddings",
    "machine learning",
    "ml",
    "diffusion",
    "prompt",
  ],
  go: ["go", "golang"],
  golang: ["go", "golang"],
  nodejs: ["nodejs", "node.js", "node"],
  node: ["nodejs", "node.js", "node"],
  "c++": ["c++", "cpp", "cplusplus"],
  cpp: ["c++", "cpp", "cplusplus"],
  "c#": ["c#", "csharp", "c sharp", ".net", "dotnet", "asp.net"],
  csharp: ["c#", "csharp", ".net", "dotnet"],
  "react native": ["react native", "reactnative"],
  mern: ["mern", "mongo", "express", "react", "node"],
  gis: ["gis", "geospatial", "postgis", "mapbox", "geofenc"],
  healthcare: ["healthcare", "fhir", "hipaa", "hl7", "clinical"],
  shopify: ["shopify", "ecommerce", "e-commerce"],
  wordpress: ["wordpress", "cms", "gutenberg"],
  application: ["desktop", "qt", "mfc", "qml", "native app"],
  desktop: ["desktop", "qt", "mfc", "qml"],
  flutter: ["flutter", "dart", "ionic"],
  ionic: ["ionic", "flutter"],
  android: ["android", "kotlin", "jetpack"],
  ios: ["ios", "swift", "swiftui", "uikit"],
  rust: ["rust", "tokio", "actix"],
  python: ["python", "fastapi", "pytorch", "pandas"],
  django: ["django"],
  angular: ["angular", "rxjs", "ngrx"],
  vue: ["vue", "vue.js", "vuejs", "pinia"],
  react: ["react", "next.js", "nextjs", "remix"],
  java: ["java", "spring", "jvm"],
  kotlin: ["kotlin"],
  php: ["php", "laravel", "symfony"],
  laravel: ["laravel", "php"],
  ruby: ["ruby", "rails"],
  rails: ["ruby", "rails"],
  nextjs: ["next.js", "nextjs", "react"],
  remix: ["remix", "react"],
};

function normalizeSkillName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[./]/g, "");
}

function parseSkillLine(rawLine) {
  let line = String(rawLine ?? "")
    .trim()
    .replace(/^[-*•]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/, "");
  if (!line || line.startsWith("---")) return null;

  for (const pattern of [SCORE_LINE, COLON_LINE, SIMPLE_LINE]) {
    const match = line.match(pattern);
    if (!match) continue;

    const score = Number(match[2]);
    if (!Number.isFinite(score) || score < 0 || score > 10) continue;

    let skill = match[1]
      .trim()
      .replace(/[█#\-*=.\u2588\u2593\u2592\u2591]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!skill || /^(output format|skill name|examples?)$/i.test(skill)) continue;

    return { skill, score };
  }

  const trailing = line.match(/^(.+?)\s+(\d{1,2})\s*$/);
  if (trailing) {
    const score = Number(trailing[2]);
    if (Number.isFinite(score) && score >= 0 && score <= 10) {
      const skill = trailing[1]
        .replace(/[█#\-*=.\u2588\u2593\u2592\u2591]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (skill) return { skill, score };
    }
  }

  return null;
}

export function parseSkillProfile(skillProfileText) {
  const scores = new Map();

  for (const line of String(skillProfileText ?? "").split("\n")) {
    const parsed = parseSkillLine(line);
    if (parsed) {
      scores.set(normalizeSkillName(parsed.skill), parsed.score);
    }
  }

  return scores;
}

/**
 * Resume stack titles like "Go + React", "AI", "Mobile(Flutter, Ionic)".
 * Ignore analyzed skill JSON — prediction uses title tokens only.
 */
export function tokenizeResumeTitle(title) {
  let raw = String(title ?? "");
  // Drop negative parentheticals: "(not for mobile)", "(Never Django)"
  raw = raw.replace(/\(([^)]*\b(?:not|never|no)\b[^)]*)\)/gi, " ");
  // Keep positive parenthetical tokens: "(Flutter, Ionic)" → Flutter Ionic
  raw = raw.replace(/\(([^)]+)\)/g, " $1 ");
  raw = raw.replace(/[/&,|]/g, " + ");

  const parts = raw
    .split(/\+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const tokens = new Set();
  for (const part of parts) {
    const cleaned = part
      .toLowerCase()
      .replace(/\b(?:for|web|scripting|with|and|the|a|an)\b/g, " ")
      .replace(/[^a-z0-9+#.\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) continue;

    tokens.add(normalizeSkillName(cleaned));
    // Also add shorter fragments for "react native", "next.js", etc.
    for (const word of cleaned.split(/[\s-]+/)) {
      const w = normalizeSkillName(word);
      if (w.length >= 2) tokens.add(w);
    }

    const aliases = TITLE_ALIASES[cleaned] || TITLE_ALIASES[normalizeSkillName(cleaned)];
    if (aliases) {
      for (const alias of aliases) tokens.add(normalizeSkillName(alias));
    }
  }

  // Single-token titles (AI, GIS, Healthcare, Rust…) — expand aliases on each token.
  for (const token of [...tokens]) {
    const aliases = TITLE_ALIASES[token];
    if (aliases) {
      for (const alias of aliases) tokens.add(normalizeSkillName(alias));
    }
  }

  return tokens;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleMatchesSkill(titleTokens, jdSkill) {
  if (!jdSkill) return false;
  for (const token of titleTokens) {
    if (!token) continue;
    if (token === jdSkill) return true;
    // Short tokens ("ai", "go", "ml") must match as whole words — not substrings
    // of unrelated skills ("train", "html", "cargo").
    if (token.length <= 2) {
      const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token)}(?:[^a-z0-9]|$)`);
      if (re.test(jdSkill)) return true;
      continue;
    }
    if (jdSkill.includes(token) || token.includes(jdSkill)) return true;
  }
  return false;
}

/**
 * Score a resume by how well its *title* lines up with high-scoring JD skills.
 * The catalog JSON skill lists are ignored.
 */
export function scoreResumeByTitle(jdScores, resumeTitle) {
  const titleTokens = tokenizeResumeTitle(resumeTitle);
  if (titleTokens.size === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;
  let hitWeight = 0;

  for (const [skill, jdScore] of jdScores) {
    if (jdScore <= 0) continue;
    const weight = jdScore * jdScore;
    totalWeight += weight;
    if (titleMatchesSkill(titleTokens, skill)) {
      weightedSum += weight;
      hitWeight += weight;
    }
  }

  if (totalWeight === 0) return 0;

  // Coverage of JD emphasis + bonus for concentrating hits on top skills.
  const coverage = weightedSum / totalWeight;
  const focus = hitWeight > 0 ? hitWeight / (hitWeight + totalWeight * 0.15) : 0;
  return Math.min(1, coverage * 0.85 + focus * 0.15);
}

/**
 * Rank resume stacks by title vs JD skill profile (ignores analyzed skill JSON).
 */
export function rankResumes(jdSkillProfileText, resumesCatalog, topN = 3) {
  const jdScores = parseSkillProfile(jdSkillProfileText);
  if (jdScores.size === 0) {
    return [];
  }

  const ranked = Object.keys(resumesCatalog || {})
    .map((name) => ({
      name,
      score: scoreResumeByTitle(jdScores, name),
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return ranked.slice(0, topN);
}


/** Score uploaded resume by techStack title only (catalog JSON ignored). */
export function scoreUploadedResume(jdScores, resume, _catalog) {
  return scoreResumeByTitle(jdScores, resume?.techStack || resume?.fileName || "");
}

export function rankUploadedResumes(jdSkillProfileText, uploadedResumes, catalog, topN = 5) {
  const jdScores = parseSkillProfile(jdSkillProfileText);
  if (jdScores.size === 0) return [];

  return (uploadedResumes || [])
    .map((resume) => ({
      id: String(resume._id),
      fileName: resume.fileName,
      techStack: resume.techStack,
      score: scoreUploadedResume(jdScores, resume, catalog),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
