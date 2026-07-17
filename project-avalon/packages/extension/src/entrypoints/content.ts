import { EXTENSION_MESSAGES } from '../utils/constants';
import { executeRemoteAction } from '../utils/action-executor';
import { runInjectionPlan } from '../utils/injection-plan-runner';
import { attachTaggedFilesInPageContext } from '../utils/page-file-attach';
import { createInjectionHelpers } from '../utils/injection-helpers';
import { findSubmitControl } from '../utils/submit-finder';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'avalon:ping') {
        sendResponse({ ok: true });
        return false;
      }

      if (message?.type === EXTENSION_MESSAGES.ATTACH_TAGGED_FILES) {
        const resume = message.resume as { base64?: string; name?: string; mimeType?: string } | undefined;
        if (!resume?.base64) {
          sendResponse({ ok: false, error: 'No résumé bytes provided' });
          return false;
        }
        void attachTaggedFilesInPageContext(
          resume.base64,
          resume.name || 'resume.pdf',
          resume.mimeType || 'application/pdf',
        )
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) =>
            sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
          );
        return true;
      }

      if (message?.type === EXTENSION_MESSAGES.RUN_INJECTION_PLAN) {
        void runInjectionPlan(message.plan)
          .then((data) => sendResponse({ ok: true, data }))
          .catch((error) =>
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        return true;
      }

      if (message?.type === EXTENSION_MESSAGES.RUN_SUBMIT) {
        try {
          const control = findSubmitControl();
          if (!control) {
            sendResponse({ ok: true, clicked: false });
          } else {
            const label = (control.textContent ?? '').trim() || control.getAttribute('value') || '';
            createInjectionHelpers().click(control);
            sendResponse({ ok: true, clicked: true, label });
          }
        } catch (error) {
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
        return false;
      }

      if (message?.type !== EXTENSION_MESSAGES.EXECUTE_IN_TAB) {
        return false;
      }

      void executeRemoteAction(message.action)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            actionId: message.action?.id ?? '',
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    });
  },
});
