import { recordApplyRun, listApplyRuns, getApplyRun } from "../services/avalonRunLog.js";

/** POST /api/agents/apply-log — append a batch of apply-run events (file + Mongo). */
export async function postApplyLog(req, res) {
  try {
    const body = req.body || {};
    if (!body.runId) return res.status(400).json({ success: false, error: "runId is required" });
    const result = await recordApplyRun(body);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.warn("POST /api/agents/apply-log error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/** GET /api/agents/apply-runs?applierName=&limit= — recent runs (no event arrays). */
export async function getApplyRuns(req, res) {
  try {
    const runs = await listApplyRuns({ applierName: req.query?.applierName, limit: req.query?.limit });
    return res.json({ success: true, runs });
  } catch (err) {
    console.warn("GET /api/agents/apply-runs error:", err.message);
    return res.status(500).json({ success: false, error: err.message, runs: [] });
  }
}

/** GET /api/agents/apply-runs/:runId — one run with full event timeline. */
export async function getApplyRunById(req, res) {
  try {
    const run = await getApplyRun(req.params?.runId);
    if (!run) return res.status(404).json({ success: false, error: "Run not found" });
    return res.json({ success: true, run });
  } catch (err) {
    console.warn("GET /api/agents/apply-runs/:runId error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}
