/** Shared session when client leaves Session ID empty (local dev default). */
export const DEFAULT_SESSION_ID = 'default';

/** Client role when connecting to the Avalon relay server. */
export type ClientRole = 'extension' | 'controller' | 'observer';

/** Dynamic attribute filter on a DOM element. */
export interface PropertyFilter {
  /** Attribute name: `class`, `id`, `data-testid`, `href`, `text`, etc. */
  attribute: string;
  /** Pattern with `?` as wildcard segment, e.g. `?__index__` or `?_id_?` */
  pattern: string;
}

/** Describes which element to act on within a page. */
export interface TargetSelector {
  tag: string;
  properties: PropertyFilter[];
  /** Zero-based index among all matching elements. Defaults to 0. */
  index?: number;
}

export type ControlType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'combobox'
  | 'checkbox'
  | 'radio'
  | 'button'
  | 'link'
  | 'file';

export type OptionsSource = 'native' | 'static-listbox' | 'probed';

export interface ActionableTarget {
  target: string;
  targetHtml: string;
  /** Parent innerText minus this control's innerText — field question / group context */
  contextText: string;
  /** Selector locating the actionable seed element. */
  control: TargetSelector;
  controlType: ControlType;
  /** Populated for native `<select>` and combobox widgets. */
  options?: { value: string; label: string }[];
  optionsSource?: OptionsSource;
}

export interface FetchActionableTreeOptions {
  /** Briefly open comboboxes to harvest options. Default false — the fill plan
   * types and picks options live, so probing is only useful for inspection. */
  probeComboboxes?: boolean;
  /** Max wait per field focus-probe in ms. Default 350. */
  probeTimeoutMs?: number;
}

export interface ActionableGroup {
  content: string;
  contentHtml: string;
  children: ActionableTarget[];
}

export type ActionableTree = ActionableGroup[];

export type ActionType =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type'
  | 'clear'
  | 'set_focus'
  | 'blur'
  | 'file_upload'
  | 'scroll_into_view'
  | 'scroll_by'
  | 'hover'
  | 'highlight'
  | 'clear_highlight'
  | 'select_option'
  | 'key_press'
  | 'wait'
  | 'get_text'
  | 'get_attribute'
  | 'set_attribute'
  | 'navigate'
  | 'open_tab'
  | 'close_tab'
  | 'reload'
  | 'screenshot'
  | 'execute_script'
  | 'read_page_state'
  | 'fill_verification_code'
  | 'fetch_actionable_tree'
  | 'apply_injection_plan';

export type PlanFieldAction =
  | 'Click'
  | 'Typing'
  | 'SelectOption'
  | 'FileUpload'
  | 'Check'
  | 'Uncheck';

export interface ActionablePageContext {
  tabId: number;
  url: string;
  title?: string;
}

/** Operations the declarative injection plan executor knows how to run. */
export type InjectionStepOp =
  | 'setValue' // text / textarea / contenteditable (executor auto-detects rich text)
  | 'setRichText' // force the contenteditable rich-text path
  | 'selectOption' // native <select>
  | 'typeCombobox' // autocomplete widget: type, then pick the matching option
  | 'setChecked' // checkbox / radio
  | 'click' // button / link
  | 'attachFile'; // file input (uses the bundled default résumé)

export interface InjectionStep {
  /** Field id ("groupIdx:childIdx") — for logging/debug. */
  id: string;
  /** Human-readable field label for the event log. */
  label: string;
  op: InjectionStepOp;
  /** Locator for the control, resolved by `findElementByTarget`. */
  control: TargetSelector;
  /** Value to type / option label to pick. Unused for `click` / `attachFile`. */
  value?: string;
  /** Desired state for `setChecked`. */
  checked?: boolean;
}

export interface InjectionPlan {
  steps: InjectionStep[];
}

export interface ApplyInjectionPlanPayload {
  /** Declarative steps executed in the content script's isolated world. */
  plan: InjectionPlan;
  page?: ActionablePageContext;
  /**
   * After all fields are filled, auto-click the Submit/Apply/Next control as the
   * final mandatory step. Defaults to true.
   */
  autoSubmit?: boolean;
  /** Delay before the auto-submit click, surfaced as a countdown. Defaults to 5000ms. */
  submitDelayMs?: number;
  /**
   * Résumé bytes to attach for any `attachFile` step. When present, the executor
   * uploads these instead of the bundled default résumé — this is how the per-job
   * AI-generated résumé is delivered.
   */
  resumeFile?: AttachedFile;
}

/** A file delivered inline (base64) for attachFile steps. */
export interface AttachedFile {
  name: string;
  mimeType: string;
  base64: string;
}

export interface RemoteAction {
  id: string;
  tabId?: number;
  target?: TargetSelector;
  action: ActionType;
  payload?: Record<string, unknown>;
  /**
   * When false, the extension must not bring the Chrome window/tab to the front
   * (Beta "grant window focus" off). Omitted / true keeps legacy focus behavior.
   * Screenshots may still force focus.
   */
  allowWindowFocus?: boolean;
}

export interface ActionResult {
  actionId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
  windowId: number;
}

/** Socket.io event names shared across clients. */
export const SOCKET_EVENTS = {
  REGISTER: 'register',
  REGISTERED: 'registered',
  EXECUTE_ACTION: 'execute-action',
  ACTION_RESULT: 'action-result',
  TABS_UPDATE: 'tabs-update',
  REQUEST_TABS: 'request-tabs',
  REQUEST_SCREENSHOT: 'request-screenshot',
  SCREENSHOT_RESULT: 'screenshot-result',
  /** Live apply lifecycle updates (file upload, field fill, submit countdown). */
  APPLY_PROGRESS: 'apply-progress',
  PING: 'ping',
  PONG: 'pong',
} as const;

/** Lifecycle phases reported while an injection plan is being applied. */
export type ApplyPhase =
  | 'navigating' // opening the job tab and waiting for it to load
  | 'files' // uploading résumé / file inputs (top priority, runs first)
  | 'fields' // filling the remaining form fields
  | 'submit-wait' // counting down before the auto-submit click
  | 'verify-wait' // counting down after submit before reading the result page
  | 'submitted' // submit / apply / next was clicked
  | 'done' // apply finished (no submit control found)
  | 'error';

/** A single live progress update broadcast to controllers and observers (e.g. Athens). */
export interface ApplyProgress {
  sessionId?: string;
  phase: ApplyPhase;
  message: string;
  /** Seconds remaining during the `submit-wait` or `verify-wait` countdown. */
  secondsLeft?: number;
  /** Steps applied so far / total, for a progress bar. */
  appliedSteps?: number;
  totalSteps?: number;
  at: number;
}

export interface RegisterPayload {
  role: ClientRole;
  /**
   * User/account namespace for the relay session pairing.
   * Allows multiple users to share a relay while still routing to the
   * correct controller/extension pair.
   */
  profileId?: string;
  sessionId?: string;
  /** Optional display name from Athens (shown in the extension session picker). */
  label?: string;
}

/** One live relay room — returned by GET /health and GET /sessions. */
export interface RelaySessionInfo {
  profileId: string;
  sessionId: string;
  label?: string;
  peers: { extension: boolean; controller: boolean };
}

export interface RegisteredPayload {
  clientId: string;
  profileId: string;
  sessionId: string;
  role: ClientRole;
  peers: { extension: boolean; controller: boolean };
}

export const ACTION_DEFINITIONS: Record<
  ActionType,
  { label: string; description: string; needsTarget: boolean }
> = {
  click: { label: 'Click', description: 'Single click on element', needsTarget: true },
  double_click: { label: 'Double click', description: 'Double click on element', needsTarget: true },
  right_click: { label: 'Right click', description: 'Context menu click', needsTarget: true },
  type: { label: 'Type', description: 'Type text into input/textarea', needsTarget: true },
  clear: { label: 'Clear', description: 'Clear input value', needsTarget: true },
  set_focus: { label: 'Set focus', description: 'Focus element', needsTarget: true },
  blur: { label: 'Blur', description: 'Remove focus from element', needsTarget: true },
  file_upload: { label: 'File upload', description: 'Set files on file input (base64)', needsTarget: true },
  scroll_into_view: { label: 'Scroll into view', description: 'Scroll element into viewport', needsTarget: true },
  scroll_by: { label: 'Scroll by', description: 'Scroll page by x/y pixels', needsTarget: false },
  hover: { label: 'Hover', description: 'Mouse over element', needsTarget: true },
  highlight: {
    label: 'Highlight',
    description: 'Outline target element with animated border',
    needsTarget: true,
  },
  clear_highlight: {
    label: 'Clear highlight',
    description: 'Remove Avalon highlight overlays from the page',
    needsTarget: false,
  },
  select_option: { label: 'Select option', description: 'Select dropdown option by value/text', needsTarget: true },
  key_press: { label: 'Key press', description: 'Dispatch keyboard event (Enter, Tab, etc.)', needsTarget: true },
  wait: { label: 'Wait', description: 'Pause for milliseconds', needsTarget: false },
  get_text: { label: 'Get text', description: 'Read element text content', needsTarget: true },
  get_attribute: { label: 'Get attribute', description: 'Read attribute value', needsTarget: true },
  set_attribute: { label: 'Set attribute', description: 'Set attribute value', needsTarget: true },
  navigate: { label: 'Navigate', description: 'Open URL in tab', needsTarget: false },
  open_tab: { label: 'Open tab', description: 'Open URL in a new tab and wait for load', needsTarget: false },
  close_tab: { label: 'Close tab', description: 'Close the target tab', needsTarget: false },
  reload: { label: 'Reload', description: 'Reload current tab', needsTarget: false },
  screenshot: { label: 'Screenshot', description: 'Capture visible tab', needsTarget: false },
  execute_script: { label: 'Execute script', description: 'Run JS in page context', needsTarget: false },
  read_page_state: {
    label: 'Read page state',
    description: 'Read page innerText and control count after submit (CSP-safe via chrome.scripting)',
    needsTarget: false,
  },
  fill_verification_code: {
    label: 'Fill verification code',
    description: 'Fill an emailed one-time/verification code into the page code inputs and submit (CSP-safe)',
    needsTarget: false,
  },
  fetch_actionable_tree: {
    label: 'Fetch actionable tree',
    description:
      'Extract grouped form controls with labels for AI agents (probeComboboxes, probeTimeoutMs in payload)',
    needsTarget: false,
  },
  apply_injection_plan: {
    label: 'Apply injection plan',
    description: 'Execute AI-generated page scripts with DOM helpers (steps in payload)',
    needsTarget: false,
  },
};

export function createActionId(): string {
  return `act_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
