import { streamFullMongoBackupZip } from "../services/mongoBackupService.js";

/**
 * GET /api/admin/backup/mongodb.zip
 * Admin-only full AthensDB export: zip of one JSON file per collection.
 */
export async function downloadMongoBackup(req, res) {
	try {
		// Full dumps can take several minutes on large databases.
		req.setTimeout(0);
		res.setTimeout(0);
		await streamFullMongoBackupZip(res);
	} catch (err) {
		console.error("[mongo-backup] failed", err);
		if (res.headersSent) {
			res.destroy(err);
			return;
		}
		const status = err.status || 500;
		return res.status(status).json({
			error: err.message || "Failed to build MongoDB backup.",
		});
	}
}
