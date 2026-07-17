import type { ActionResult, RemoteAction } from '@avalon/shared';
import { EXTENSION_MESSAGES } from './constants';

export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'avalon:ping' });
    return;
  } catch {
    // Not injected yet — fall through.
  }

  const manifest = browser.runtime.getManifest();
  const files = manifest.content_scripts?.flatMap((entry) => entry.js ?? []) ?? [];
  if (files.length === 0) return;

  try {
    await browser.scripting.executeScript({ target: { tabId }, files });
  } catch {
    // Restricted URL (chrome://, Web Store, etc.)
  }
}

export async function runActionInTab(tabId: number, action: RemoteAction): Promise<ActionResult> {
  await ensureContentScript(tabId);
  const response = await browser.tabs.sendMessage(tabId, {
    type: EXTENSION_MESSAGES.EXECUTE_IN_TAB,
    action,
  });
  return response as ActionResult;
}
