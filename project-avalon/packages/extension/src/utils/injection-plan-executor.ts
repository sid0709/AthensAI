import {
  type ApplyInjectionPlanPayload,
  type ActionResult,
  type ApplyProgress,
  type AttachedFile,
  type InjectionPlan,
} from '@avalon/shared';
import { EXTENSION_MESSAGES } from './constants';
import { ensureContentScript } from './tab-messages';
import { FILE_TARGET_ATTR, type InjectionPlanRunResult } from './injection-plan-runner';
import { waitForDomSettle } from './page-ready';

const DEFAULT_SUBMIT_DELAY_MS = 5000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run a (possibly partial) injection plan in the page and return its result. */
async function runPlanInTab(tabId: number, plan: InjectionPlan): Promise<InjectionPlanRunResult> {
  const response = (await browser.tabs.sendMessage(tabId, {
    type: EXTENSION_MESSAGES.RUN_INJECTION_PLAN,
    plan,
  })) as { ok?: boolean; data?: InjectionPlanRunResult; error?: string } | undefined;

  if (!response?.ok || !response.data) {
    throw new Error(response?.error ?? 'Injection plan failed');
  }
  return response.data;
}

/**
 * Runs in the page's MAIN world (injected by the extension via chrome.scripting,
 * so it is IMMUNE to the page's CSP — unlike an inline <script>, which Greenhouse/
 * Ashby block). Assigns the résumé to every tagged input using the native `files`
 * setter (React-safe) and fires both `change` and a synthetic `drop` so plain file
 * inputs AND drag-and-drop zones (react-dropzone) both register the file.
 */
async function setFilesInMainWorld(attr: string, base64: string, name: string, mime: string) {
  const result: { attached: number; found: number; errors: string[] } = {
    attached: 0,
    found: 0,
    errors: [],
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const makeFile = () => new File([bytes], name, { type: mime });

    const nodes = Array.from(document.querySelectorAll(`[${attr}]`));
    result.found = nodes.length;
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');

    // Assign via the native setter (React-safe), then fire input + change. This
    // works for plain file inputs AND drag-and-drop zones (their input onChange).
    // We deliberately do NOT fire a synthetic `drop`: some dropzones reset the
    // input during their drop handler, which would clear the file we just set.
    const assign = (input: HTMLInputElement) => {
      const dt = new DataTransfer();
      dt.items.add(makeFile());
      if (desc && desc.set) desc.set.call(input, dt.files);
      else input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    for (const node of nodes) {
      const input = node as HTMLInputElement;
      try {
        assign(input);
        // A framework's onChange can transiently reset the input mid-dispatch;
        // let it settle, and re-assign once if the file didn't stick. Judging
        // success synchronously (as before) produced false failures.
        await wait(80);
        if (!input.files || input.files.length === 0) {
          assign(input);
          await wait(120);
        }
        if (input.files && input.files.length > 0) result.attached += 1;
        else result.errors.push(`files empty after assign: ${input.id || input.name || 'input'}`);
      } catch (err) {
        result.errors.push(String(err));
      }
      input.removeAttribute(attr);
    }
  } catch (err) {
    result.errors.push(String(err));
  }
  return result;
}

/** Set files on tagged inputs via the page's MAIN world (CSP-immune, React-safe). */
async function attachTaggedFiles(tabId: number, resume: AttachedFile): Promise<number> {
  if (!resume?.base64) throw new Error('No tailored résumé PDF to attach');
  const name = (resume.name || 'resume.pdf').replace(/\.txt\.pdf$/i, '.pdf');
  const mime = resume.mimeType || 'application/pdf';

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: setFilesInMainWorld,
    args: [FILE_TARGET_ATTR, resume.base64, name, mime],
  });
  const res = (injection?.result as { attached?: number; found?: number; errors?: string[] }) ?? {};
  if ((res.attached ?? 0) === 0 && (res.found ?? 0) > 0 && res.errors?.length) {
    console.warn('[Avalon] MAIN-world attach errors:', res.errors);
  }
  return res.attached ?? 0;
}

export async function executeInjectionPlan(
  tabId: number,
  payload: ApplyInjectionPlanPayload,
  onProgress?: (progress: Omit<ApplyProgress, 'at'>) => void,
): Promise<ActionResult['data']> {
  const steps = payload.plan?.steps ?? [];
  if (steps.length === 0) {
    throw new Error('Injection plan has no steps');
  }

  const emit = (progress: Omit<ApplyProgress, 'at'>) => onProgress?.(progress);

  await ensureContentScript(tabId);

  const fileSteps = steps.filter((s) => s.op === 'attachFile');
  const fieldSteps = steps.filter((s) => s.op !== 'attachFile');
  const totalSteps = steps.length;
  let applied = 0;
  let failed = 0;
  let filesFound = 0;
  let filesAttached = 0;
  const results: InjectionPlanRunResult['results'] = [];
  const resumeName = payload.resumeFile?.name ?? 'tailored résumé.pdf';

  // --- Phase 1: résumé upload (required when plan includes attachFile; skip if none).
  if (fileSteps.length > 0) {
    if (!payload.resumeFile?.base64) {
      const msg = 'Tailored résumé PDF is required but was not provided';
      emit({ phase: 'error', message: msg, appliedSteps: 0, totalSteps });
      throw new Error(msg);
    }

    emit({ phase: 'files', message: `Attaching résumé (${resumeName})…`, appliedSteps: 0, totalSteps });
    const fileRun = await runPlanInTab(tabId, { steps: fileSteps });
    results.push(...fileRun.results);
    applied += fileRun.applied;
    failed += fileRun.failed;
    filesFound = fileRun.fileTargets.length;

    let fileFailed = 0;
    if (filesFound > 0) {
      filesAttached = await attachTaggedFiles(tabId, payload.resumeFile);
      fileFailed = filesFound - filesAttached;
      emit({
        phase: 'files',
        message: `Résumé set on ${filesAttached}/${filesFound} input(s) — waiting for upload to finish…`,
        appliedSteps: applied,
        totalSteps,
      });
      // Wait for the upload + any résumé-parse re-render to settle BEFORE filling
      // fields, so values aren't wiped by a late re-render.
      await waitForDomSettle(tabId);
    }

    // NON-FATAL: a 0/1 "attach" reading is often a false negative (a dropzone
    // briefly resets the input during its onChange, or the confirmation is async).
    // Aborting here would kill an otherwise-valid application, so we only WARN and
    // continue — the field fill + submit + verify still run, and the verify step
    // reports the true outcome (e.g. a genuine "résumé required").
    if (filesFound === 0) {
      emit({
        phase: 'files',
        message: 'No résumé field found in the plan — continuing without a file',
        appliedSteps: applied,
        totalSteps,
      });
    } else if (fileFailed > 0) {
      emit({
        phase: 'files',
        message: `Résumé attach unconfirmed on ${fileFailed}/${filesFound} input(s) — continuing`,
        appliedSteps: applied,
        totalSteps,
      });
    } else {
      emit({
        phase: 'files',
        message: `Résumé attached (${resumeName})`,
        appliedSteps: applied,
        totalSteps,
      });
    }
  } else {
    emit({
      phase: 'files',
      message: 'No résumé field in plan — skipping file attach',
      appliedSteps: applied,
      totalSteps,
    });
  }

  // --- Phase 2: remaining form fields.
  if (fieldSteps.length > 0) {
    emit({ phase: 'fields', message: `Filling ${fieldSteps.length} field(s)…`, appliedSteps: applied, totalSteps });
    const fieldRun = await runPlanInTab(tabId, { steps: fieldSteps });
    results.push(...fieldRun.results);
    applied += fieldRun.applied;
    failed += fieldRun.failed;
    emit({ phase: 'fields', message: 'Fields filled', appliedSteps: applied, totalSteps });
  }

  // --- Phase 3: countdown, then auto-click Submit/Apply/Next.
  let submitted = false;
  if (payload.autoSubmit !== false) {
    const delayMs = payload.submitDelayMs ?? DEFAULT_SUBMIT_DELAY_MS;
    for (let secondsLeft = Math.ceil(delayMs / 1000); secondsLeft > 0; secondsLeft -= 1) {
      emit({
        phase: 'submit-wait',
        message: `Submitting in ${secondsLeft}…`,
        secondsLeft,
        appliedSteps: applied,
        totalSteps,
      });
      await sleep(1000);
    }

    const submitResponse = (await browser.tabs.sendMessage(tabId, {
      type: EXTENSION_MESSAGES.RUN_SUBMIT,
    })) as { ok?: boolean; clicked?: boolean; label?: string; error?: string } | undefined;

    submitted = Boolean(submitResponse?.clicked);
    if (submitted) {
      emit({ phase: 'submitted', message: `Submitted${submitResponse?.label ? ` (${submitResponse.label})` : ''}`, appliedSteps: applied, totalSteps });
    } else {
      emit({ phase: 'done', message: 'No submit control found — left for manual review', appliedSteps: applied, totalSteps });
    }
  } else {
    emit({ phase: 'done', message: 'Fill complete', appliedSteps: applied, totalSteps });
  }

  return {
    applied,
    skipped: 0,
    failed,
    result: results,
    submitted,
    filesFound,
    filesAttached,
  };
}
