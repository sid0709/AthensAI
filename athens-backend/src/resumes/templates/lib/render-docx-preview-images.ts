import { spawn } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PREVIEW_DPI =
  Number.parseInt(process.env.RESUME_TEMPLATE_PREVIEW_DPI || '144', 10) || 144;
const DEFAULT_TIMEOUT_MS =
  Number.parseInt(process.env.RESUME_TEMPLATE_PREVIEW_TIMEOUT_MS || '30000', 10) ||
  30000;

export type ResumeTemplatePreviewPage = {
  mimeType: string;
  dataBase64: string;
  width: number;
  height: number;
};

function candidatePaths(name: 'soffice' | 'pdftoppm'): string[] {
  const home = os.homedir();
  if (name === 'soffice') {
    return [
      process.env.SOFFICE_PATH,
      process.env.LIBREOFFICE_PATH,
      'soffice',
      'libreoffice',
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      path.join(
        home,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/soffice',
      ),
    ].filter((v): v is string => Boolean(v));
  }
  return [
    process.env.PDFTOPPM_PATH,
    'pdftoppm',
    path.join(
      home,
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm',
    ),
  ].filter((v): v is string => Boolean(v));
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${path.basename(command)} timed out after ${timeoutMs}ms`));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${path.basename(command)} exited with ${code}: ${stderr || stdout || 'no output'}`,
        ),
      );
    });
  });
}

async function runWithCandidates(
  names: 'soffice' | 'pdftoppm',
  args: string[],
): Promise<void> {
  let lastError: unknown = null;
  for (const command of candidatePaths(names)) {
    try {
      await runCommand(command, args);
      return;
    } catch (err) {
      lastError = err;
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') break;
    }
  }
  throw lastError || new Error(`Could not find executable: ${names}`);
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  if (
    buffer.length >= 24 &&
    buffer.toString('ascii', 1, 4) === 'PNG' &&
    buffer.toString('ascii', 12, 16) === 'IHDR'
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return { width: 0, height: 0 };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function renderDocxPreviewImages(
  buffer: Buffer,
): Promise<ResumeTemplatePreviewPage[]> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'athens-resume-preview-'));
  const profileDir = path.join(tmpDir, 'lo-profile');
  try {
    const docxPath = path.join(tmpDir, 'resume-template-preview.docx');
    await writeFile(docxPath, buffer);
    await runWithCandidates('soffice', [
      '--headless',
      '--norestore',
      '--nodefault',
      '--nolockcheck',
      '--nofirststartwizard',
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      '--convert-to',
      'pdf',
      '--outdir',
      tmpDir,
      docxPath,
    ]);
    const pdfPath = docxPath.replace(/\.docx$/i, '.pdf');
    if (!(await fileExists(pdfPath))) {
      throw new Error('DOCX preview conversion did not produce a PDF.');
    }
    const prefix = path.join(tmpDir, 'page');
    await runWithCandidates('pdftoppm', [
      '-png',
      '-r',
      String(PREVIEW_DPI),
      pdfPath,
      prefix,
    ]);
    const files = (await readdir(tmpDir))
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort(
        (a, b) =>
          Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0),
      );
    const pages: ResumeTemplatePreviewPage[] = [];
    for (const file of files) {
      const png = await readFile(path.join(tmpDir, file));
      const { width, height } = pngSize(png);
      pages.push({
        mimeType: 'image/png',
        dataBase64: png.toString('base64'),
        width,
        height,
      });
    }
    if (!pages.length) {
      throw new Error('DOCX preview conversion did not produce page images.');
    }
    return pages;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
