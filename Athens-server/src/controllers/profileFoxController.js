import { stat } from "fs/promises";
import { readPdfAsBase64, selectResumePdfPath } from "../services/resumeSelectionService.js";

/**
 * POST /api/fox/resolved-resume
 * Body: { resumeFolderUrl, fullName, jobDescription?, skills?[] }
 * Returns best-matching resume PDF under resumeFolderUrl as base64 for Fox upload_semantic.
 */
export async function postFoxResolvedResume(req, res) {
	try {
		const { resumeFolderUrl, fullName, jobDescription, skills } = req.body || {};
		if (!resumeFolderUrl || typeof resumeFolderUrl !== "string") {
			return res.status(400).json({ success: false, error: "resumeFolderUrl is required" });
		}
		if (!fullName || typeof fullName !== "string") {
			return res.status(400).json({ success: false, error: "fullName is required" });
		}
		const picked = await selectResumePdfPath({
			fullName: fullName.trim(),
			jobDescription: typeof jobDescription === "string" ? jobDescription : "",
			resumeFolderUrl: resumeFolderUrl.trim(),
			skills: Array.isArray(skills) ? skills : [],
		});
		if (!picked.resumePdfPath) {
			return res.status(422).json({
				success: false,
				error: picked.error || "Could not resolve a resume PDF on disk",
				picked,
			});
		}
		const base64Data = await readPdfAsBase64(picked.resumePdfPath);
		const statPath = picked.resumePdfPath;
		const st = await stat(statPath);
		return res.status(200).json({
			success: true,
			data: {
				base64Data,
				fileName: `${fullName.trim()}.pdf`,
				mimeType: "application/pdf",
				sizeBytes: st.size,
				resumePdfPath: picked.resumePdfPath,
				subfolder: picked.subfolder,
				matchScore: picked.score,
			},
		});
	} catch (err) {
		console.error("POST /api/fox/resolved-resume", err);
		return res.status(500).json({ success: false, error: err.message });
	}
}
