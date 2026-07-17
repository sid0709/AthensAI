export type Purpose = "summary" | "skills" | "experience";
export const PURPOSES: Purpose[] = ["summary", "skills", "experience"];

export type SectionType = Purpose | "education";
export const SECTION_TYPES: SectionType[] = ["summary", "skills", "experience", "education"];

export const SECTION_LABEL: Record<SectionType, string> = {
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  education: "Education",
};

export type HeadingStyle = "underline" | "bar" | "plain" | "centered-rules";

// How each work-experience entry is arranged — the main structural difference
// between resume formats.
export type ExperienceLayout =
  | "default" // title (bold) + dates right; company in accent italic below
  | "standard" // title (bold); company (bold) + dates·location right below
  | "single-line" // Title | Company | Location | Date on one bold row
  | "modern" // title (accent) | company; dates·location muted below
  | "harvard" // company (bold) + location right; title (bold) + dates right
  | "jakes" // company (bold) + location right; title (italic) + dates (italic) right
  | "two-col-entry" // left: title + dates · right: company | location + paragraph
  | "dev"; // company (bold) + role (muted) inline; bullets; dates muted; divider

export type TemplateDef = {
  id: string;
  name: string;
  blurb: string;
  columns: 1 | 2;
  sidebar: SectionType[]; // sections placed in the sidebar (2-col only)
  sidebarSide: "left" | "right";
  sidebarWidthPct: number;
  sidebarTint: boolean; // accent-tinted sidebar background
  heading: HeadingStyle;
  headingAlign: "left" | "center"; // alignment of section headings (Summary, Experience…)
  defaultHeaderAlign: "left" | "center"; // alignment of the name/contact header
  experienceLayout: ExperienceLayout;
  contactIcons: boolean; // show small icons before contact items
  nameColor: "accent" | "text";
  headingCase?: "upper" | "title"; // section heading case (default "upper")
  headingMuted?: boolean; // render headings in muted gray instead of titleColor
  // Heading + skill-category color: "accent" (default, = section titleColor) or
  // "text" (dark body color — e.g. Bold keeps the accent only in the top bar).
  headingColor?: "accent" | "text";
  nameUppercase?: boolean; // UPPERCASE the name
  nameRule?: boolean; // thin rule under the name
  topBar?: boolean; // full-width accent band at the very top of the page
  cornerAccent?: boolean; // decorative tinted shape in the top-right corner
  labelGutter?: boolean; // section heading sits in a left gutter, body on the right
  // Theme tokens applied when the template is selected (still user-overridable).
  defaults?: { font?: string; accent?: string };
};

export type StepKind = "fine-tune" | "final";

export type GenStep = {
  id: string;
  purpose: Purpose;
  kind: StepKind;
  name: string;
  prompt: string;
  /** JSON schema text — only used/required when kind === "final". */
  schema: string;
  /**
   * Skip this step when generating for a structured (MongoDB) job — i.e. the
   * Job Search page and the Agent pipeline, where the job already carries fetched
   * skills (available via the {job_skills} token). Ignored for free-text
   * generation on the Resume Generator page, where the step always runs.
   */
  skipForStructuredJobs?: boolean;
};

// Visual document theme — every field reflects live in the preview.
export type PaperSize = "letter" | "a4";

export type ResumeTheme = {
  font: string;
  baseSize: number; // body pt
  nameSize: number; // header name pt
  titleSize: number; // default section-title pt
  accent: string; // section-title / divider color
  text: string; // body text color
  headerAlign: "left" | "center";
  paper: PaperSize; // page size used for the on-screen page AND the PDF export
  margin: number; // page margin in inches (applied as page padding)
};

// Preview/layout section — its order is independent of the generation steps.
export type LayoutSection = {
  id: string;
  type: SectionType;
  title: string;
  titleColor: string;
  titleSize: number;
  bodySize: number;
};

export type ProviderId = "openai" | "deepseek";

// OpenAI reasoning models accept reasoning_effort. "default" = don't send it.
export type ReasoningEffort = "default" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type GeneratorConfig = {
  provider: ProviderId;
  model: string;
  reasoningEffort: ReasoningEffort;
  templateId: string;
  uploadedTemplate?: UploadedTemplateManifest;
  theme: ResumeTheme;
  layout: LayoutSection[];
  systemInstruction: string;
  jobDescription: string;
  steps: GenStep[];
};

export type TemplateSlot = {
  index: number;
  paragraphIndex: number;
  section: Purpose;
  companyHint?: string;
  isBullet: boolean;
  experienceIndex?: number;
};

export type UploadedTemplateManifest = {
  id: string;
  name: string;
  source: "uploaded";
  format: "docx";
  fileName?: string;
  slotCount: number;
  sectionsFound: Purpose[];
  slots: TemplateSlot[];
  warnings: string[];
  uploadedAt?: string;
};

export function isUploadedTemplateId(templateId: string) {
  return templateId.startsWith("upload:");
}

export function uploadedTemplateMongoId(templateId: string) {
  return templateId.replace(/^upload:/, "");
}

// The reference token users can drop into any prompt; replaced with the actual
// job-description text at generation time.
const JOB_DESC_TOKEN = "{job_description}";

export type CareerEntry = { company: string; title: string; period: string; description: string };
export type EducationEntry = { school: string; degree: string; period: string };

// Token + cost summary returned by the backend (mirrors llmService.summarizeUsage).
export type UsageBreakdown = {
  model: string | null;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number | null;
  savings: number | null;
};

// AI-generated resume content extracted from the run's `sections`, mapped to the
// preview's render shape. Lenient about the exact JSON the model returned.
export type GeneratedContent = {
  summary: string | null;
  skills: { category: string; items: string[] }[] | null;
  experience: PreviewCareer[] | null;
};

function normalizeGenerated(sections: Record<string, unknown> | null | undefined): GeneratedContent {
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const summarySec = obj(sections?.["summary"]);
  const skillsSec = obj(sections?.["skills"]);
  const expSec = obj(sections?.["experience"]);

  const summary = typeof summarySec.summary === "string" ? summarySec.summary : null;

  const skillsArr = Array.isArray(skillsSec.skills) ? skillsSec.skills : null;
  const skills = skillsArr
    ? skillsArr
        .map((g) => {
          const row = obj(g);
          const items = Array.isArray(row.items) ? row.items.map(String) : [];
          return { category: String(row.category ?? ""), items };
        })
        .filter((g) => g.category || g.items.length)
    : null;

  const expArr = Array.isArray(expSec.experiences) ? expSec.experiences : Array.isArray(expSec.experience) ? expSec.experience : null;
  const experience = expArr
    ? expArr.map((e) => {
        const row = obj(e);
        return {
          title: String(row.title ?? row.role ?? ""),
          company: String(row.company ?? ""),
          location: String(row.location ?? ""),
          period: String(row.period ?? row.dates ?? ""),
          bullets: Array.isArray(row.bullets) ? row.bullets.map(String) : [],
        };
      })
    : null;

  return { summary, skills: skills && skills.length ? skills : null, experience: experience && experience.length ? experience : null };
}

// Merge ONE final step's output into the running generated content, so a section
// can update in the preview the instant its final step completes.
function mergeGeneratedSection(prev: GeneratedContent | null, purpose: string, output: unknown): GeneratedContent {
  const base = prev ?? { summary: null, skills: null, experience: null };
  const one = normalizeGenerated({ [purpose]: output });
  if (purpose === "summary") return { ...base, summary: one.summary ?? base.summary };
  if (purpose === "skills") return { ...base, skills: one.skills ?? base.skills };
  if (purpose === "experience") return { ...base, experience: one.experience ?? base.experience };
  return base;
}

// Live per-step progress streamed over SSE during generation.
export type GenProgressStep = {
  index: number;
  name: string;
  purpose: string;
  kind: string;
  status: "running" | "done";
  usage?: UsageBreakdown;
  output?: unknown; // the model's reply for this step (parsed JSON for finals)
};
export type GenProgress = {
  steps: GenProgressStep[];
  cumulative: UsageBreakdown | null;
  done: boolean;
};

export type Identity = {
  fullName: string;
  location: string;
  email: string;
  phone: string;
  linkedin: string;
  careers: CareerEntry[];
  education: EducationEntry[];
};

export type PreviewCareer = { title: string; company: string; location: string; period: string; bullets: string[] };

export type PreviewEdit =
  | { kind: "summary"; text: string }
  | { kind: "bullet"; exp: number; bullet: number; text: string };
