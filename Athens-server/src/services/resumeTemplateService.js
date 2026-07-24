import { ObjectId } from "mongodb";
import { getMongoDb, resumeTemplatesCollection } from "../db/mongo.js";
import { parseTemplateDocx } from "./parseTemplateDocx.js";
import { fillTemplateDocx } from "./fillTemplateDocx.js";
import { renderDocxPreviewImages } from "./renderDocxPreviewImages.js";
import { deleteStoredObject, putBinaryObject, readStoredObject, storageSlug } from "./firebase/objectStore.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function cleanString(v) {
  return String(v ?? "").trim();
}

function toManifest(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    source: "uploaded",
    format: "docx",
    fileName: doc.fileName,
    slotCount: doc.slotCount ?? 0,
    sectionsFound: Array.isArray(doc.sectionsFound) ? doc.sectionsFound : [],
    slots: Array.isArray(doc.slots) ? doc.slots : [],
    warnings: Array.isArray(doc.warnings) ? doc.warnings : [],
    uploadedAt: doc.uploadedAt,
  };
}

async function readContent(doc) {
  return readStoredObject(doc, { collection: resumeTemplatesCollection, legacyDb: getMongoDb(), legacyBucketName: "resume_template_files" });
}

async function deleteStoredContent(doc) {
  return deleteStoredObject(doc, { collection: resumeTemplatesCollection, legacyDb: getMongoDb(), legacyBucketName: "resume_template_files" });
}

export async function listResumeTemplates(ownerName) {
  if (!resumeTemplatesCollection) throw new Error("Database not ready");
  const name = cleanString(ownerName);
  if (!name) throw new Error("ownerName is required");
  const docs = await resumeTemplatesCollection.find({ ownerName: name }).sort({ uploadedAt: -1 }).toArray();
  return docs.map(toManifest);
}

export async function getResumeTemplate(id, ownerName) {
  if (!resumeTemplatesCollection) throw new Error("Database not ready");
  const name = cleanString(ownerName);
  if (!name) throw new Error("ownerName is required");
  let objectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    throw new Error("Invalid template id");
  }
  const doc = await resumeTemplatesCollection.findOne({ _id: objectId, ownerName: name });
  if (!doc) return null;
  return toManifest(doc);
}

export async function createResumeTemplate(payload) {
  if (!resumeTemplatesCollection) throw new Error("Database not ready");

  const ownerName = cleanString(payload.ownerName);
  const fileName = cleanString(payload.fileName);
  const contentBase64 = String(payload.contentBase64 || "");
  const identity = payload.identity && typeof payload.identity === "object" ? payload.identity : {};

  if (!ownerName) throw new Error("ownerName is required");
  if (!fileName) throw new Error("fileName is required");
  if (!contentBase64) throw new Error("contentBase64 is required");
  if (!/\.docx$/i.test(fileName)) throw new Error("Only .docx templates are supported.");

  const buffer = Buffer.from(contentBase64, "base64");
  if (!buffer.length) throw new Error("Empty file content");

  const parsed = parseTemplateDocx(buffer, identity);
  const _id = new ObjectId();
  const stored = await putBinaryObject({
    buffer,
    objectPath: `resume-templates/${storageSlug(ownerName)}/${String(_id)}/content`,
    mimeType: DOCX_MIME,
    metadata: { ownerName, templateId: String(_id), originalFileName: fileName },
  });
  const now = new Date().toISOString();
  const baseName = fileName.replace(/\.docx$/i, "");

  const doc = {
    _id,
    ownerName,
    name: cleanString(payload.name) || baseName,
    fileName,
    mimeType: DOCX_MIME,
    sizeBytes: buffer.length,
    storage: stored.storage,
    file: stored.file,
    contentBase64: stored.contentBase64,
    slotCount: parsed.slotCount,
    sectionsFound: parsed.sectionsFound,
    slots: parsed.slots,
    warnings: parsed.warnings,
    uploadedAt: now,
    updatedAt: now,
  };

  const result = await resumeTemplatesCollection.insertOne(doc);
  return toManifest({ ...doc, _id: result.insertedId });
}

export async function deleteResumeTemplate(id, ownerName) {
  if (!resumeTemplatesCollection) throw new Error("Database not ready");
  const name = cleanString(ownerName);
  if (!name) throw new Error("ownerName is required");

  let objectId;
  try {
    objectId = new ObjectId(id);
  } catch {
    throw new Error("Invalid template id");
  }

  const doc = await resumeTemplatesCollection.findOne({ _id: objectId, ownerName: name });
  if (!doc) throw new Error("Template not found");

  await deleteStoredContent(doc);
  await resumeTemplatesCollection.deleteOne({ _id: objectId });
  return { deleted: true, id: String(objectId) };
}

export async function fillResumeTemplate({ templateId, ownerName, sections }) {
  if (!resumeTemplatesCollection) throw new Error("Database not ready");
  const name = cleanString(ownerName);
  if (!name) throw new Error("ownerName is required");

  let objectId;
  try {
    objectId = new ObjectId(templateId);
  } catch {
    throw new Error("Invalid template id");
  }

  const doc = await resumeTemplatesCollection.findOne({ _id: objectId, ownerName: name });
  if (!doc) throw new Error("Template not found");

  const buffer = await readContent(doc);
  if (!buffer) throw new Error("Template file content missing");

  const manifest = {
    slots: doc.slots,
    warnings: doc.warnings,
  };
  const result = fillTemplateDocx(buffer, manifest, sections);
  return {
    buffer: result.buffer,
    warnings: result.warnings,
    fileName: doc.fileName,
    templateName: doc.name,
  };
}

export async function previewResumeTemplate({ templateId, ownerName, sections }) {
  const fillResult = await fillResumeTemplate({ templateId, ownerName, sections: sections ?? {} });
  const mammoth = await import("mammoth");
  const htmlResult = await mammoth.convertToHtml({ buffer: fillResult.buffer });
  return {
    html: htmlResult.value || "",
    warnings: [...(fillResult.warnings || []), ...(htmlResult.messages || []).map((m) => m.message).filter(Boolean)],
    templateName: fillResult.templateName,
  };
}

export async function previewResumeTemplateImages({ templateId, ownerName, sections }) {
  const fillResult = await fillResumeTemplate({ templateId, ownerName, sections: sections ?? {} });
  const pages = await renderDocxPreviewImages(fillResult.buffer);
  return {
    pages,
    warnings: fillResult.warnings || [],
    templateName: fillResult.templateName,
  };
}
