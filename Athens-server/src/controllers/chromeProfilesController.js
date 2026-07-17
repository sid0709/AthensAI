// List the local Google Chrome profiles (for the Deploy Agent "Chrome profile"
// picker). Read-only: parses Chrome's `Local State` profile.info_cache.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function safeApplier(name) {
  return String(name || "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "applicant";
}

/** Persistent per-applicant master user-data-dir for optional Chrome session import. */
function masterProfileDir(applierName) {
  return path.join(REPO_ROOT, ".data", "chrome-sessions", `${safeApplier(applierName)}-chrome`);
}

// Don't copy Chrome lock/socket files or the large regenerable caches when forking.
const SKIP_RE = /^(Singleton.*|lockfile|.*\.lock|Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|GraphiteDawnCache|DawnCache|DawnGraphiteCache|DawnWebGPUCache|Service Worker|CacheStorage|Crashpad|Crash Reports|component_crx_cache|extensions_crx_cache|optimization_guide_model_store|Safe Browsing|segmentation_platform|BudgetDatabase|blob_storage)$/i;

// User-data-dir locations by OS (the one containing `Local State`).
const CHROME_DIRS = [
  "Library/Application Support/Google/Chrome", // macOS
  ".config/google-chrome", // Linux
  "AppData/Local/Google/Chrome/User Data", // Windows
];

function chromeUserDataDir() {
  for (const rel of CHROME_DIRS) {
    const p = path.join(os.homedir(), rel);
    if (fs.existsSync(path.join(p, "Local State"))) return p;
  }
  return null;
}

/** GET /personal/chrome-profiles — [{ dir, name, email }] for installed Chrome profiles. */
export async function listChromeProfiles(req, res) {
  try {
    const base = chromeUserDataDir();
    if (!base) return res.json({ success: true, profiles: [], userDataDir: null });
    const ls = JSON.parse(fs.readFileSync(path.join(base, "Local State"), "utf8"));
    const cache = ls?.profile?.info_cache || {};
    const profiles = Object.entries(cache)
      .filter(([dir]) => fs.existsSync(path.join(base, dir)))
      .map(([dir, info]) => ({ dir, name: info?.name || dir, email: info?.user_name || "" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return res.json({ success: true, profiles, userDataDir: base });
  } catch (err) {
    console.warn("GET /api/personal/chrome-profiles error:", err.message);
    return res.json({ success: true, profiles: [], error: err.message });
  }
}

/** GET /personal/chrome-profiles/avatar?dir=Profile%2063 — the profile's Google photo. */
export async function chromeProfileAvatar(req, res) {
  try {
    const base = chromeUserDataDir();
    const dir = String(req.query?.dir || "");
    if (!base || !dir) return res.status(404).end();
    // Guard against path traversal — only allow a direct profile subdir name.
    const safeDir = path.basename(dir);
    const file = path.join(base, safeDir, "Google Profile Picture.png");
    if (!file.startsWith(path.join(base, safeDir)) || !fs.existsSync(file)) return res.status(404).end();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    return fs.createReadStream(file).pipe(res);
  } catch {
    return res.status(404).end();
  }
}

/**
 * POST /personal/chrome-profiles/import { applierName, profileDir }
 * Forks the chosen Chrome profile into the applicant's persistent master
 * user-data-dir (<claudeCwd>/.sessions/<applier>-chrome/Default). Every agent run
 * then launches REAL Chrome from a copy of it — already signed in, concurrently.
 * Re-importing refreshes the master with the profile's current logins. Chrome must
 * be quit so cookies / Login Data are readable.
 */
export async function importChromeSession(req, res) {
  const applierName = String(req.body?.applierName || "").trim();
  const profileDir = String(req.body?.profileDir || "").trim();
  if (!applierName || !profileDir) {
    return res.status(400).json({ success: false, error: "applierName and profileDir are required" });
  }
  try {
    const base = chromeUserDataDir();
    if (!base) return res.status(400).json({ success: false, error: "No local Google Chrome installation found." });
    const src = path.join(base, path.basename(profileDir)); // guard against traversal
    if (!fs.existsSync(src)) return res.status(404).json({ success: false, error: `Chrome profile "${profileDir}" not found.` });

    const master = masterProfileDir(applierName);
    const profileDirName = path.basename(profileDir);
    const ls = JSON.parse(fs.readFileSync(path.join(base, "Local State"), "utf8"));
    const profileInfo = ls?.profile?.info_cache?.[profileDirName] || { name: profileDirName, user_name: "" };

    // Re-import = fresh fork: drop the old master so stale logins don't linger.
    try { if (fs.existsSync(master)) fs.rmSync(master, { recursive: true, force: true }); } catch {}
    fs.mkdirSync(master, { recursive: true });
    fs.cpSync(src, path.join(master, profileDirName), {
      recursive: true,
      force: true,
      filter: (p) => !SKIP_RE.test(path.basename(p)),
    });
    fs.writeFileSync(path.join(master, "Local State"), JSON.stringify({
      profile: { info_cache: { [profileDirName]: profileInfo }, last_used: profileDirName },
    }));
    fs.writeFileSync(path.join(master, ".seeded-profile"), profileDirName);

    return res.json({ success: true, message: "Session imported — agents now launch your signed-in Chrome (a copy, concurrently)." });
  } catch (err) {
    return res.status(500).json({ success: false, error: String(err?.message || err).slice(0, 300) });
  }
}
