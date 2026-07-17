import { SEED_DOCUMENTS } from "../data/resumes/seedDocument";
import type {
  BulkUploadResult,
  ResumeDocument,
  ResumeSummary,
  ResumeTemplateRef,
  StoredDocumentRecord,
} from "../types/resume";
import {
  deleteDocumentRecord,
  getDocumentRecord,
  listDocumentRecords,
  listSummaries,
  listTemplates,
  saveDocumentRecord,
  saveTemplate,
} from "./resumeStorage";

type CatalogListener = () => void;

const listeners = new Set<CatalogListener>();

export function onCatalogChange(fn: CatalogListener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emitChange() {
  listeners.forEach((fn) => fn());
}

function parseResumeFromFileName(name: string): Partial<ResumeSummary> {
  const base = name.replace(/\.(pdf|docx?|txt)$/i, "");
  return {
    name: base || "Uploaded Resume",
    version: "v1.0",
    updated: "Just now",
    matchScore: 75 + Math.floor(Math.random() * 20),
    skills: ["React", "TypeScript"],
    isPrimary: false,
  };
}

function makeUploadedDocument(fileName: string, id: string): StoredDocumentRecord {
  const seed = SEED_DOCUMENTS[0];
  const partial = parseResumeFromFileName(fileName);
  const summary: ResumeSummary = {
    id,
    name: partial.name ?? "Uploaded Resume",
    version: partial.version ?? "v1.0",
    updated: partial.updated ?? "Just now",
    matchScore: partial.matchScore ?? 80,
    skills: partial.skills ?? [],
    isPrimary: false,
    documentId: `doc-${id}`,
  };
  const document: ResumeDocument = {
    ...structuredClone(seed.document),
    id: summary.documentId!,
    identity: { ...seed.document.identity },
    summary: `Uploaded from ${fileName}. ${seed.document.summary}`,
  };
  return { summary, document };
}

export interface ResumeCatalogService {
  listResumes(): Promise<ResumeSummary[]>;
  getDocument(id: string): Promise<ResumeDocument | null>;
  listTemplates(): Promise<ResumeTemplateRef[]>;
  uploadResume(file: File): Promise<ResumeSummary>;
  bulkUpload(files: File[]): Promise<BulkUploadResult>;
  saveTemplate(template: ResumeTemplateRef): Promise<ResumeTemplateRef>;
}

export const resumeCatalog: ResumeCatalogService = {
  async listResumes() {
    return listSummaries();
  },

  async getDocument(id: string) {
    const record = await getDocumentRecord(id);
    if (record) return record.document;
    const records = await listDocumentRecords();
    const byDoc = records.find((r) => r.document.id === id);
    return byDoc?.document ?? null;
  },

  async listTemplates() {
    return listTemplates();
  },

  async uploadResume(file: File) {
    const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const record = makeUploadedDocument(file.name, id);
    await saveDocumentRecord(record);
    emitChange();
    return record.summary;
  },

  async bulkUpload(files: File[]) {
    const ok: ResumeSummary[] = [];
    const failed: string[] = [];
    for (const file of files) {
      try {
        const summary = await this.uploadResume(file);
        ok.push(summary);
      } catch {
        failed.push(file.name);
      }
    }
    emitChange();
    return { ok, failed };
  },

  async saveTemplate(template: ResumeTemplateRef) {
    const saved = await saveTemplate({ ...template, source: "uploaded" });
    emitChange();
    return saved;
  },
};

export async function deleteResume(id: string) {
  await deleteDocumentRecord(id);
  emitChange();
}

export async function setPrimaryResume(id: string) {
  const records = await listDocumentRecords();
  for (const record of records) {
    const isPrimary = record.summary.id === id;
    if (record.summary.isPrimary !== isPrimary) {
      await saveDocumentRecord({
        ...record,
        summary: { ...record.summary, isPrimary },
      });
    }
  }
  emitChange();
}
