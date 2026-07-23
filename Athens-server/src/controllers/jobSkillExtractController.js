import {
  getSkillExtractionStatus,
  startSkillExtractionSession,
  stopSkillExtractionSession,
} from '../services/jobSkillExtraction/extractSession.js';

export async function getSkillExtractStatus(req, res) {
  try {
    const applierName = String(req.query.applierName || '').trim();
    const status = await getSkillExtractionStatus({ applierName });
    return res.json({ success: true, ...status });
  } catch (err) {
    console.error('GET /api/jobs/skill-extract/status error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function startSkillExtract(req, res) {
  try {
    const applierName = req.body?.applierName;
    const limit = req.body?.limit;
    const result = await startSkillExtractionSession({ applierName, limit });
    return res.status(result.started ? 202 : 200).json({ success: true, ...result });
  } catch (err) {
    const status = err.message.includes('already running') ? 409 : 400;
    console.error('POST /api/jobs/skill-extract/start error', err);
    return res.status(status).json({ success: false, error: err.message });
  }
}

export async function stopSkillExtract(req, res) {
  try {
    const result = stopSkillExtractionSession();
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('POST /api/jobs/skill-extract/stop error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
