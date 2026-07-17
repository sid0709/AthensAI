export interface ResumeIdentity {
  fullName: string;
  location: string;
  email: string;
  phone: string;
  linkedin: string;
}

export interface GeneratorCareer {
  company: string;
  title: string;
  period: string;
}

export interface GeneratorEducation {
  school: string;
  degree: string;
  period: string;
}

export interface GeneratorIdentity extends ResumeIdentity {
  careers: GeneratorCareer[];
  education: GeneratorEducation[];
}

export interface ResumeExperience {
  id: string;
  company: string;
  role: string;
  location: string;
  startDate: string;
  endDate: string;
  bullets: string[];
}

export interface ResumeSkills {
  languages: string[];
  frameworks: string[];
  databases: string[];
  cloudDevOps: string[];
}

export interface ResumeEducation {
  id: string;
  school: string;
  degree: string;
  location: string;
  graduationDate: string;
}

export interface ResumeDocument {
  id: string;
  identity: ResumeIdentity;
  summary: string;
  experiences: ResumeExperience[];
  skills: ResumeSkills;
  education: ResumeEducation[];
}

export interface ResumeSummary {
  id: string;
  name: string;
  version: string;
  updated: string;
  matchScore: number;
  skills: string[];
  isPrimary: boolean;
  documentId?: string;
}

export type TemplateLayout =
  | "standard"
  | "two-column"
  | "classic"
  | "centered"
  | "minimal"
  | "compact"
  | "modern"
  | "bold";

export interface ResumeTemplateRef {
  id: string;
  name: string;
  layout: TemplateLayout;
  description: string;
  source: "builtin" | "uploaded";
}

export interface ResumeTheme {
  font: string;
  bodySizePt: number;
  nameSizePt: number;
  accentColor: string;
  textColor: string;
  headerAlign: "left" | "center";
  paperSize: "letter" | "a4";
  marginIn: number;
}

export type SectionId = "summary" | "experience" | "skills" | "education";

export interface SectionLayoutConfig {
  id: SectionId;
  titleSizePt: number;
  bodySizePt: number;
  color: string;
  order: number;
}

export type ResumeStackCatalog = Record<string, Record<string, number>>;

export type StepPurpose = "summary" | "skills" | "experience" | "education";
export type StepKind = "fine-tune" | "final";

export interface RefinementStep {
  id: string;
  purpose: StepPurpose;
  kind: StepKind;
  name: string;
  prompt: string;
  schema?: string;
  /**
   * Skip this step for structured (MongoDB) jobs — Job Search + Agent runs, where
   * the job's pre-fetched skills are injected via the {job_skills} token. Free-text
   * generation on the Resume Generator page always runs the step.
   */
  skipForStructuredJobs?: boolean;
}

export interface ResumeSkillEntry {
  name: string;
  category: "hard" | "soft" | "devops" | "tools" | "domain";
  level: number;
  /** @deprecated legacy 0.1–10 scale from older analyses */
  strength?: number;
}

export interface UserResumeSummary {
  id: string;
  ownerId: string | null;
  ownerName: string;
  techStack: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  extractedText?: string;
  isPrimary: boolean;
  source?: "uploaded" | "generated";
  generationId?: string;
  templateId?: string;
  analyzed?: boolean;
  analyzedAt?: string | null;
  skillCount?: number;
  uploadedAt: string;
  updatedAt?: string;
}

export interface UserResumeDetail extends UserResumeSummary {
  contentBase64: string | null;
}

export interface RefinementPipeline {
  id: string;
  name: string;
  steps: RefinementStep[];
  isDefault?: boolean;
}

export type GenerationRunStatus = "completed" | "failed" | "running";

export interface GenerationRun {
  id: string;
  status: GenerationRunStatus;
  createdAt: string;
  jobTitle?: string;
  jobDescription: string;
  model: string;
  provider: string;
  templateId: string;
  tokens: number;
  costUsd: number;
  document: ResumeDocument;
  refinementSteps: RefinementStep[];
}

export interface EditorDraft {
  document: ResumeDocument;
  templateId: string;
  theme: ResumeTheme;
  sections: SectionLayoutConfig[];
  provider: string;
  model: string;
  reasoningEffort: string;
  systemInstruction: string;
  jobDescription: string;
  refinementSteps: RefinementStep[];
  generatorIdentity?: GeneratorIdentity;
  baseResumeId?: string;
}

export interface HistoryRunSummary {
  id: string;
  status: GenerationRunStatus;
  createdAt: string;
  jobTitle?: string;
  jobDescription: string;
  model: string;
  provider: string;
  templateId?: string;
  techStack?: string;
  tokens: number;
  costUsd: number;
}

export interface HistoryRunDetail extends HistoryRunSummary {
  sections?: Record<string, unknown>;
  config?: Record<string, unknown>;
  identity?: GeneratorIdentity;
  perStep?: unknown[];
  usage?: { totalTokens?: number; cost?: number };
  skillProfile?: ResumeSkillEntry[];
  analyzed?: boolean;
  analyzedAt?: string;
  skillAnalysisError?: string | null;
}

export interface GenerateInput {
  jobDescription: string;
  identity: ResumeIdentity;
  stackId?: string;
  baseDocument?: ResumeDocument;
}

export interface GenerateResult {
  document: ResumeDocument;
  tokens: number;
  costUsd: number;
  jobTitle?: string;
}

export interface BulkUploadResult {
  ok: ResumeSummary[];
  failed: string[];
}

export interface StoredDocumentRecord {
  summary: ResumeSummary;
  document: ResumeDocument;
}
