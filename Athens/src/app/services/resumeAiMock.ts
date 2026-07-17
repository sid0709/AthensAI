import type {
  GenerateInput,
  GenerateResult,
  RefinementStep,
  ResumeDocument,
  ResumeExperience,
} from "../types/resume";

const ACTION_VERBS = ["Built", "Shipped", "Designed", "Optimized", "Led", "Implemented", "Refactored", "Automated"];

function extractJobTitle(jd: string): string | undefined {
  const lines = jd.split("\n").map((l) => l.trim()).filter(Boolean);
  const titleLine = lines.find((l) => /engineer|developer|architect|manager|designer/i.test(l));
  return titleLine?.slice(0, 80);
}

function extractKeywords(jd: string): string[] {
  const tech = [
    "React", "TypeScript", "Node.js", "Python", "AWS", "Docker", "Kubernetes",
    "PostgreSQL", "GraphQL", "Next.js", "Go", "Java", "Rust", "LLM", "AI",
  ];
  const lower = jd.toLowerCase();
  return tech.filter((t) => lower.includes(t.toLowerCase()));
}

function tailorSummary(jd: string, base: string): string {
  const keywords = extractKeywords(jd);
  if (keywords.length === 0) return base;
  const kw = keywords.slice(0, 4).join(", ");
  return base.replace(/\.$/, "") + `. Strong alignment with ${kw} based on target role requirements.`;
}

function tailorBullets(bullets: string[], jd: string): string[] {
  const keywords = extractKeywords(jd);
  return bullets.map((b, i) => {
    const verb = ACTION_VERBS[i % ACTION_VERBS.length];
    let text = b.replace(/^(Led|Built|Designed|Reduced|Collaborated|Mentored|Implemented)\b/, verb);
    if (keywords[i % keywords.length]) {
      const kw = keywords[i % keywords.length];
      if (!text.toLowerCase().includes(kw.toLowerCase())) {
        text = text.replace(/\.$/, "") + ` using ${kw}.`;
      }
    }
    return text;
  });
}

function tailorExperiences(experiences: ResumeExperience[], jd: string): ResumeExperience[] {
  return experiences.map((exp) => ({
    ...exp,
    bullets: tailorBullets(exp.bullets, jd),
  }));
}

function estimateTokens(jd: string, steps: number): number {
  return Math.round(jd.length * 2.5 + 12000 + steps * 3500 + Math.random() * 5000);
}

function estimateCost(tokens: number, model: string): number {
  const rate = model.includes("mini") ? 0.0000006 : 0.000002;
  return Math.round(tokens * rate * 10000) / 10000;
}

export interface ResumeAiService {
  generate(input: GenerateInput, model?: string): Promise<GenerateResult>;
  refine(doc: ResumeDocument, step: RefinementStep): Promise<ResumeDocument>;
}

export const resumeAiMock: ResumeAiService = {
  async generate(input, model = "gpt-4o-mini") {
    await delay(800);
    const base = input.baseDocument ?? createEmptyDoc(input.identity);
    const keywords = extractKeywords(input.jobDescription);

    const document: ResumeDocument = {
      ...structuredClone(base),
      id: `gen-${Date.now()}`,
      identity: { ...input.identity },
      summary: tailorSummary(input.jobDescription, base.summary),
      experiences: tailorExperiences(base.experiences, input.jobDescription),
      skills: {
        ...base.skills,
        languages: mergeUnique(base.skills.languages, keywords.slice(0, 2)),
        frameworks: mergeUnique(base.skills.frameworks, keywords.slice(2, 4)),
      },
    };

    const tokens = estimateTokens(input.jobDescription, 0);
    return {
      document,
      tokens,
      costUsd: estimateCost(tokens, model),
      jobTitle: extractJobTitle(input.jobDescription),
    };
  },

  async refine(doc, step) {
    await delay(600);
    const result = structuredClone(doc);

    if (step.section === "experience" || step.section === "Experience") {
      result.experiences = result.experiences.map((exp, ei) => ({
        ...exp,
        bullets: exp.bullets.map((b, bi) => {
          if (step.mode === "fine-tune") {
            const words = b.split(/\s+/);
            const trimmed = words.slice(0, 28).join(" ");
            const verb = ACTION_VERBS[(ei + bi) % ACTION_VERBS.length];
            return trimmed.replace(/^\w+/, verb).replace(/\bi\b/gi, "").trim();
          }
          const parts = b.split(/,\s+/);
          if (parts.length > 1) return parts.reverse().join("; ") + ".";
          return b.replace(/using (\w+) to achieve/gi, "via $1 for");
        }),
      }));
    }

    if (step.section === "summary" || step.section === "Summary") {
      result.summary = result.summary
        .replace(/\.\s+/g, ". ")
        .replace(/strong alignment/gi, "direct experience");
    }

    return result;
  },
};

function mergeUnique(arr: string[], extra: string[]): string[] {
  const set = new Set([...extra, ...arr]);
  return Array.from(set).slice(0, 6);
}

function createEmptyDoc(identity: GenerateInput["identity"]): ResumeDocument {
  return {
    id: "empty",
    identity,
    summary: "Experienced professional seeking new opportunities.",
    experiences: [],
    skills: { languages: [], frameworks: [], databases: [], cloudDevOps: [] },
    education: [],
  };
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function estimateRefinementUsage(steps: number, jdLength: number, model = "gpt-4o-mini") {
  const tokens = estimateTokens("x".repeat(jdLength), steps);
  return { tokens, costUsd: estimateCost(tokens, model) };
}
