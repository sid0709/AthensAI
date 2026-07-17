import {
  listResumeTemplates,
  getResumeTemplate,
  createResumeTemplate,
  deleteResumeTemplate,
  fillResumeTemplate,
  previewResumeTemplate,
  previewResumeTemplateImages,
} from "../services/resumeTemplateService.js";

export async function listResumeTemplatesHandler(req, res) {
  try {
    const ownerName = String(req.query?.ownerName ?? "").trim();
    if (!ownerName) return res.status(400).json({ success: false, error: "ownerName is required" });
    const templates = await listResumeTemplates(ownerName);
    return res.json({ success: true, templates });
  } catch (err) {
    console.error("GET /api/personal/resume-templates error", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function getResumeTemplateHandler(req, res) {
  try {
    const ownerName = String(req.query?.ownerName ?? "").trim();
    if (!ownerName) return res.status(400).json({ success: false, error: "ownerName is required" });
    const template = await getResumeTemplate(req.params.id, ownerName);
    if (!template) return res.status(404).json({ success: false, error: "Template not found" });
    return res.json({ success: true, template });
  } catch (err) {
    console.error("GET /api/personal/resume-templates/:id error", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function createResumeTemplateHandler(req, res) {
  try {
    const { ownerName, fileName, contentBase64, name, identity } = req.body || {};
    const template = await createResumeTemplate({ ownerName, fileName, contentBase64, name, identity });
    return res.status(201).json({ success: true, template });
  } catch (err) {
    console.error("POST /api/personal/resume-templates error", err);
    const status = /required|Invalid|Only|Empty|must contain/i.test(err.message) ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

export async function deleteResumeTemplateHandler(req, res) {
  try {
    const ownerName = String(req.query?.ownerName ?? req.body?.ownerName ?? "").trim();
    if (!ownerName) return res.status(400).json({ success: false, error: "ownerName is required" });
    const result = await deleteResumeTemplate(req.params.id, ownerName);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("DELETE /api/personal/resume-templates/:id error", err);
    const status = /not found|Invalid/i.test(err.message) ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

export async function fillResumeTemplateHandler(req, res) {
  try {
    const { templateId, ownerName, sections, fileName } = req.body || {};
    const id = String(templateId ?? "").replace(/^upload:/, "");
    if (!id) return res.status(400).json({ success: false, error: "templateId is required" });
    if (!ownerName) return res.status(400).json({ success: false, error: "ownerName is required" });
    if (!sections || typeof sections !== "object") {
      return res.status(400).json({ success: false, error: "sections is required" });
    }

    const result = await fillResumeTemplate({ templateId: id, ownerName, sections });
    const rawName = String(fileName || result.fileName || "resume.docx").replace(/[^\w.\- ]+/g, "_");
    const outName = rawName.toLowerCase().endsWith(".docx") ? rawName : `${rawName.replace(/\.(pdf|doc)$/i, "")}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${outName}"`);
    res.setHeader("Content-Length", result.buffer.length);
    if (result.warnings?.length) {
      res.setHeader("X-Resume-Warnings", encodeURIComponent(result.warnings.join(" | ")));
    }
    return res.end(result.buffer);
  } catch (err) {
    console.error("POST /api/personal/resume-template-fill error", err);
    const status = /required|Invalid|not found|missing/i.test(err.message) ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

export async function previewResumeTemplateHandler(req, res) {
  try {
    const { templateId, ownerName, sections } = req.body || {};
    const id = String(templateId ?? "").replace(/^upload:/, "");
    if (!id) return res.status(400).json({ success: false, error: "templateId is required" });
    if (!ownerName) return res.status(400).json({ success: false, error: "ownerName is required" });

    const result = await previewResumeTemplate({
      templateId: id,
      ownerName,
      sections: sections && typeof sections === "object" ? sections : {},
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("POST /api/personal/resume-template-preview error", err);
    const status = /required|Invalid|not found|missing/i.test(err.message) ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

export async function previewResumeTemplateImagesHandler(req, res) {
  try {
    const { templateId, ownerName, sections } = req.body || {};
    const id = String(templateId ?? "").replace(/^upload:/, "");
    if (!id) return res.status(400).json({ success: false, error: "templateId is required" });
    if (!ownerName) return res.status(400).json({ success: false, error: "ownerName is required" });

    const result = await previewResumeTemplateImages({
      templateId: id,
      ownerName,
      sections: sections && typeof sections === "object" ? sections : {},
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("POST /api/personal/resume-template-preview-images error", err);
    const status = /required|Invalid|not found|missing/i.test(err.message) ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}
