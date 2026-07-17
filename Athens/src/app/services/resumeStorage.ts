import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  BUILTIN_TEMPLATES,
  DEFAULT_IDENTITY,
  DEFAULT_PIPELINE,
  DEFAULT_THEME,
  SEED_DOCUMENTS,
  SEED_STACK_CATALOG,
  createDefaultEditorDraft,
} from "../data/resumes/seedDocument";
import type {
  EditorDraft,
  GenerationRun,
  RefinementPipeline,
  ResumeDocument,
  ResumeStackCatalog,
  ResumeSummary,
  ResumeTemplateRef,
  ResumeTheme,
  SectionLayoutConfig,
  StoredDocumentRecord,
} from "../types/resume";

interface AthensResumeDB extends DBSchema {
  documents: {
    key: string;
    value: StoredDocumentRecord;
  };
  generationRuns: {
    key: string;
    value: GenerationRun;
    indexes: { "by-date": string };
  };
  templates: {
    key: string;
    value: ResumeTemplateRef;
  };
  settings: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = "athens-resumes";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<AthensResumeDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<AthensResumeDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("documents", { keyPath: "summary.id" });
        const runs = db.createObjectStore("generationRuns", { keyPath: "id" });
        runs.createIndex("by-date", "createdAt");
        db.createObjectStore("templates", { keyPath: "id" });
        db.createObjectStore("settings");
      },
    });
  }
  return dbPromise;
}

async function ensureSeeded() {
  const db = await getDb();
  const count = await db.count("documents");
  if (count > 0) return;

  const tx = db.transaction(["documents", "templates", "settings"], "readwrite");
  for (const record of SEED_DOCUMENTS) {
    await tx.objectStore("documents").put(record);
  }
  for (const tpl of BUILTIN_TEMPLATES) {
    await tx.objectStore("templates").put(tpl);
  }
  await tx.objectStore("settings").put(DEFAULT_IDENTITY, "identityProfile");
  await tx.objectStore("settings").put({ ...DEFAULT_THEME }, "theme");
  await tx.objectStore("settings").put(SEED_STACK_CATALOG, "stackCatalog");
  await tx.objectStore("settings").put([DEFAULT_PIPELINE], "refinementPipelines");
  await tx.objectStore("settings").put(createDefaultEditorDraft(), "editorDraft");
  await tx.done;
}

export async function initResumeStorage() {
  await ensureSeeded();
}

export async function listDocumentRecords(): Promise<StoredDocumentRecord[]> {
  await ensureSeeded();
  const db = await getDb();
  return db.getAll("documents");
}

export async function listSummaries(): Promise<ResumeSummary[]> {
  const records = await listDocumentRecords();
  return records.map((r) => r.summary);
}

export async function getDocumentRecord(id: string): Promise<StoredDocumentRecord | undefined> {
  await ensureSeeded();
  const db = await getDb();
  return db.get("documents", id);
}

export async function getDocumentByDocId(documentId: string): Promise<ResumeDocument | null> {
  const records = await listDocumentRecords();
  const found = records.find((r) => r.document.id === documentId || r.summary.documentId === documentId);
  return found?.document ?? null;
}

export async function saveDocumentRecord(record: StoredDocumentRecord): Promise<void> {
  const db = await getDb();
  await db.put("documents", record);
}

export async function deleteDocumentRecord(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("documents", id);
}

export async function listTemplates(): Promise<ResumeTemplateRef[]> {
  await ensureSeeded();
  const db = await getDb();
  return db.getAll("templates");
}

export async function saveTemplate(template: ResumeTemplateRef): Promise<ResumeTemplateRef> {
  const db = await getDb();
  await db.put("templates", template);
  return template;
}

export async function listGenerationRuns(): Promise<GenerationRun[]> {
  await ensureSeeded();
  const db = await getDb();
  const runs = await db.getAllFromIndex("generationRuns", "by-date");
  return runs.reverse();
}

export async function saveGenerationRun(run: GenerationRun): Promise<void> {
  const db = await getDb();
  await db.put("generationRuns", run);
}

export async function getGenerationRun(id: string): Promise<GenerationRun | undefined> {
  const db = await getDb();
  return db.get("generationRuns", id);
}

export async function getIdentityProfile() {
  await ensureSeeded();
  const db = await getDb();
  return (await db.get("settings", "identityProfile")) ?? DEFAULT_IDENTITY;
}

export async function saveIdentityProfile(profile: typeof DEFAULT_IDENTITY) {
  const db = await getDb();
  await db.put("settings", profile, "identityProfile");
}

export async function getStackCatalog(): Promise<ResumeStackCatalog> {
  await ensureSeeded();
  const db = await getDb();
  return (await db.get("settings", "stackCatalog")) ?? SEED_STACK_CATALOG;
}

export async function saveStackCatalog(catalog: ResumeStackCatalog) {
  const db = await getDb();
  await db.put("settings", catalog, "stackCatalog");
}

export async function getRefinementPipelines(): Promise<RefinementPipeline[]> {
  await ensureSeeded();
  const db = await getDb();
  return (await db.get("settings", "refinementPipelines")) ?? [DEFAULT_PIPELINE];
}

export async function saveRefinementPipelines(pipelines: RefinementPipeline[]) {
  const db = await getDb();
  await db.put("settings", pipelines, "refinementPipelines");
}

export async function getEditorDraft(): Promise<EditorDraft> {
  await ensureSeeded();
  const db = await getDb();
  return (await db.get("settings", "editorDraft")) ?? createDefaultEditorDraft();
}

export async function saveEditorDraft(draft: EditorDraft) {
  const db = await getDb();
  await db.put("settings", draft, "editorDraft");
}

export async function getDefaultTheme(): Promise<ResumeTheme> {
  await ensureSeeded();
  const db = await getDb();
  return (await db.get("settings", "theme")) ?? { ...DEFAULT_THEME };
}

export async function saveDefaultTheme(theme: ResumeTheme) {
  const db = await getDb();
  await db.put("settings", theme, "theme");
}

export async function getDefaultSections(): Promise<SectionLayoutConfig[]> {
  const draft = await getEditorDraft();
  return draft.sections;
}
