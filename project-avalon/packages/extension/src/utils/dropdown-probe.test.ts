import { JSDOM } from 'jsdom';
import {
  collectFocusProbeCandidates,
  staticComboboxOptions,
  waitForDropdownWithObserver,
} from './dropdown-probe.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

async function withDom(html: string, fn: (body: HTMLElement) => Promise<void>): Promise<void> {
  const dom = new JSDOM(html);
  const { window } = dom;
  for (const key of ['document', 'window', 'MutationObserver', 'HTMLElement', 'HTMLInputElement'] as const) {
    // @ts-expect-error jsdom globals
    globalThis[key] = window[key];
  }
  window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const style = window.getComputedStyle(this);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
    }
    return { width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, x: 0, y: 0, toJSON() {} };
  };
  await fn(window.document.body);
  dom.window.close();
}

async function runTests() {
  await withDom(
    `
    <body>
      <input id="city" type="text" role="combobox" aria-controls="react-select-city-listbox" />
      <input id="hidden" type="text" style="display:none" />
      <div role="listbox" id="react-select-city-listbox">
        <div role="option">New York</div>
        <div role="option">Los Angeles</div>
      </div>
    </body>
  `,
    async (body) => {
      const input = body.querySelector('#city') as HTMLInputElement;
      const result = staticComboboxOptions(input);
      assert(Boolean(result), 'staticComboboxOptions should find listbox');
      assert(result!.options!.length === 2, `expected 2 options, got ${result!.options!.length}`);
      assert(result!.source === 'static-listbox', 'source should be static-listbox');

      const candidates = collectFocusProbeCandidates(body);
      assert(candidates.length === 1, `expected 1 candidate, got ${candidates.length}`);
      assert(candidates[0].id === 'city', 'visible text input should be candidate');
    },
  );

  await withDom(
    `
    <body>
      <input id="loc" type="text" />
    </body>
  `,
    async (body) => {
      const input = body.querySelector('#loc') as HTMLInputElement;
      const promise = waitForDropdownWithObserver(input, 500, () => {
        const lb = body.querySelector('#react-select-loc-listbox');
        if (!lb) return [];
        return Array.from(lb.querySelectorAll('[role="option"]')).map((o) => ({
          value: o.textContent!.trim(),
          label: o.textContent!.trim(),
        }));
      });

      setTimeout(() => {
        const listbox = body.ownerDocument.createElement('div');
        listbox.id = 'react-select-loc-listbox';
        listbox.setAttribute('role', 'listbox');
        listbox.innerHTML = '<div role="option">Chicago</div>';
        body.appendChild(listbox);
        input.setAttribute('aria-controls', 'react-select-loc-listbox');
      }, 50);

      const options = await promise;
      assert(options.length === 1, `observer should harvest 1 option, got ${options.length}`);
      assert(options[0].label === 'Chicago', `option label: "${options[0].label}"`);
    },
  );

  await withDom(
    `
    <body>
      <input id="ashby-loc" role="combobox" aria-autocomplete="list" placeholder="Start typing..." />
      <input id="explicit" type="text" />
    </body>
  `,
    async (body) => {
      const candidates = collectFocusProbeCandidates(body);
      assert(candidates.length === 2, `expected 2 candidates, got ${candidates.length}`);
      assert(
        candidates.some((c) => c.id === 'ashby-loc'),
        'implicit-type combobox input should be a probe candidate',
      );
    },
  );

  console.log('dropdown-probe ok');
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
