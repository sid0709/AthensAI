import { spawn } from "child_process";
import { readFile, readdir, rm, stat, writeFile, mkdtemp } from "fs/promises";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

const PREVIEW_DPI = Number.parseInt(process.env.RESUME_TEMPLATE_PREVIEW_DPI || "144", 10) || 144;
const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.RESUME_TEMPLATE_PREVIEW_TIMEOUT_MS || "30000", 10) || 30000;

function candidatePaths(names) {
  const home = os.homedir();
  return names.filter(Boolean).flatMap((name) => {
    if (name === "soffice") {
      return [
        process.env.SOFFICE_PATH,
        process.env.LIBREOFFICE_PATH,
        "soffice",
        "libreoffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        path.join(home, ".cache/codex-runtimes/codex-primary-runtime/dependencies/bin/soffice"),
      ].filter(Boolean);
    }
    if (name === "pdftoppm") {
      return [
        process.env.PDFTOPPM_PATH,
        "pdftoppm",
        path.join(home, ".cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm"),
      ].filter(Boolean);
    }
    return [name];
  });
}

function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${path.basename(command)} timed out after ${timeoutMs}ms`));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${path.basename(command)} exited with ${code}: ${stderr || stdout || "no output"}`));
    });
  });
}

async function runWithCandidates(names, args, options) {
  const candidates = candidatePaths(names);
  let lastError = null;
  for (const command of candidates) {
    try {
      return await runCommand(command, args, options);
    } catch (err) {
      lastError = err;
      if (err?.code !== "ENOENT") break;
    }
  }
  throw lastError || new Error(`Could not find executable: ${names.join(" or ")}`);
}

function pngSize(buffer) {
  if (
    buffer.length >= 24 &&
    buffer.toString("ascii", 1, 4) === "PNG" &&
    buffer.toString("ascii", 12, 16) === "IHDR"
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return { width: 0, height: 0 };
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function convertDocxToPdf(docxPath, outDir, profileDir) {
  await runWithCandidates(
    ["soffice"],
    [
      "--headless",
      "--norestore",
      "--nodefault",
      "--nolockcheck",
      "--nofirststartwizard",
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      docxPath,
    ],
    { timeoutMs: DEFAULT_TIMEOUT_MS },
  );
  const pdfPath = docxPath.replace(/\.docx$/i, ".pdf");
  if (!(await fileExists(pdfPath))) throw new Error("DOCX preview conversion did not produce a PDF.");
  return pdfPath;
}

async function pdfToPngPages(pdfPath, outDir) {
  const prefix = path.join(outDir, "page");
  await runWithCandidates(
    ["pdftoppm"],
    ["-png", "-r", String(PREVIEW_DPI), pdfPath, prefix],
    { timeoutMs: DEFAULT_TIMEOUT_MS },
  );
  const files = (await readdir(outDir))
    .filter((name) => /^page-\d+\.png$/i.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0));

  const pages = [];
  for (const file of files) {
    const buffer = await readFile(path.join(outDir, file));
    const { width, height } = pngSize(buffer);
    pages.push({
      mimeType: "image/png",
      dataBase64: buffer.toString("base64"),
      width,
      height,
    });
  }
  if (!pages.length) throw new Error("DOCX preview conversion did not produce page images.");
  return pages;
}

export async function renderDocxPreviewImages(buffer) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "athens-resume-preview-"));
  const profileDir = path.join(tmpDir, "lo-profile");
  try {
    const docxPath = path.join(tmpDir, "resume-template-preview.docx");
    await writeFile(docxPath, buffer);
    const pdfPath = await convertDocxToPdf(docxPath, tmpDir, profileDir);
    return await pdfToPngPages(pdfPath, tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
