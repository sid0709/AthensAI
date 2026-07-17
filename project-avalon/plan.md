# Plan: `fetchActionableTree` — extract actionable form tree for AI agents

## Context

The Avalon system lets a controller (frontend) drive a target page through a browser

extension content script over a [Socket.io](http://Socket.io) relay. Today the controller must hand-craft a

`TargetSelector` (tag + property patterns + index) for every element it wants to act on.

For **AI-agent automation** we need the page to describe itself: a compact tree of

*actionable* elements (inputs, buttons, links) each paired with the human-readable

**label/question text** that tells the agent what the control is for.

The output for each actionable unit is `content`, `target`, `contentHtml`, `targetHtml`:

- **target** = an actionable component the agent can click/type `<a>`, `<button>`, `<input>`, …).

- **content** = the surrounding label/question text (e.g. *"What do you want to work on?"*).

Key constraint (per user): **compute inside the extension content script** and emit only

the compact tree — never ship the whole page HTML to the server.

### Decisions locked with the user

- **Location:** algorithm lives in the **extension** (content script runs in the live DOM).

- **Output:** **grouped tree** — each parent node carries `contentcontentHtml` plus a

  `children[]` of targets.

- **Target identity:** keep **both** the climbed *child unit* (for grouping/label) **and** a

  selector to the actual *actionable seed* element (so the agent can act precisely).

- **Seeds:** standard form controls only — `a, button, input, textarea, select`.

---

## The algorithm (core logic, not code)

Operates on a root `document.body`). Uses `innerText` (rendered text) so visually hidden

labels don't pollute results.

### Phase A — collect seeds

`root.querySelectorAll('a, button, input, textarea, select')`. Skip `input[type=hidden]`

and elements that are not rendered (no layout box) to avoid junk.

### Phase B — resolve each seed → "child" unit

`text(el)` = `el.innerText` trimmed.

- If `text(seed)` is non-empty → the seed itself is the child (e.g. `<button>Yes</button>`).

- If empty (bare checkbox / text input) → climb `parentElement` until the first ancestor

  whose `text()` is non-empty; that ancestor is the child.

  - Case 1: checkbox → `span._container` (empty) → `div._option` ("AI / Agents") → **child**.

- Stop climbing at `rootbody`; fall back to the seed if nothing qualifies.

Record, per resolved child element, the list of seeds that resolved to it (usually one).

### Phase C — dedup children to "smallest units"

From the set of unique child elements, **drop any child that is a DOM ancestor of another

child** (it isn't the smallest unit).

- Case 2: the hidden `<input type=checkbox>` climbs to `div._container_1svni` whose text is

  "YesNo"; that div **contains** the `YesNo` button children → dropped. The spurious

  hidden control disappears for free. Remaining children: the two buttons.

### Phase D — find the "parent" for each child

Climb from the child's `parentElement` upward; the parent is the **first** ancestor where:

- `tagName === 'FIELDSET'` (fieldset is always a parent), **or**

- it introduces label text beyond its contained children, i.e.

  `leftoverText(ancestor, childSet)` is non-empty.

`leftoverText(node, childSet)` = the text of `node` **excluding** any text that lives inside

a child unit. Compute by walking `node`'s text nodes and skipping any text node that has an

ancestor present in `childSet` (no DOM mutation). Normalize whitespace.

- Case 1: parent = `<fieldset>`; leftover = "What do you want to work on? Select all that apply".

- Case 2: `div._container_1svni` leftover = "" (only Yes/No) → keep climbing →

  `div._fieldEntry` leftover = "Are you legally authorized to work in the United States?" → parent.

### Phase E — assemble the grouped tree

Group children by their resolved parent element (Map keyed by element):

- `content` = `leftoverText(parent, childSet)` (the shared question/label).

- `contentHtml` = parent's HTML **with the child-unit subtrees stripped** (clone parent,

  remove contained child nodes, serialize) — the pure label markup, kept light.

- For each child in the group, push a target entry:

  - `target` = `text(childUnit)` (e.g. "AI / Agents", "Yes"). For `<select>`, override to the

    control's accessible name `aria-label` / `name`), since its raw text is just the joined

    options — the candidates live in `options[]` instead.

  - `targetHtml` = `childUnit.outerHTML`.

  - `control` = `TargetSelector` locating the actionable **seed** (so the agent can act).

  - `controlType` = semantic role derived from the seed: `select`, `checkbox`, `radio`,

    `text`, `textarea`, `button`, `link`, `file` — tells the agent how to act.

  - `options?` = candidate list, **populated only for `<select>`** (one `{value,label}` per

    `<option>`). See "Special case: `<select>`" below.

Result: `ActionableGroup[]`. Case 1 → 1 group / 5 children; Case 2 → 1 group / 2 children.

### Special case: `<select>` (choice control with inline candidates)

A radio/checkbox group expresses its candidates as **sibling children** (Case 1). A

`<select>` instead **collapses all candidates into one control**, so the candidate array must

live *inside that single target*:

- `<select>` is a seed; its `innerText` (joined option text) is non-empty → it is its own

  child. Parent-finding is unaffected: the option text sits inside the child, so

  `leftoverText(parent)` excludes it and `content` is still the question/label.

- Set `controlType: 'select'` and fill `options[] = Array.from(select.options).map(o =>

  ({ value: o.value, label: o.text.trim() }))`.

- The agent acts on it via the existing `select_option` action using one of `options[].value`.

### `buildControlSelector(seedEl)` helper

Generate a `TargetSelector` that uniquely resolves back to the seed, reusing the existing

matcher: pick discriminating attributes in priority order `id`, `name`, `type`, then a

`data-*`, then `class`), set `tag`, then compute `index` as the seed's position among

`findElementsByTarget(document, selector)`. Verify `findElementByTarget(...) === seedEl`;

if not unique, add more properties / rely on index.

---

## Files to change

### 1. `packages/shared/src/types.ts` (shared types + new action)

- Add `'fetch_actionable_tree'` to the `ActionType` union and an `ACTION_DEFINITIONS` entry

  `needsTarget: false`).

- Add the result types so frontend and extension agree on shape:

  ```ts

  interface ActionableTarget {

    target: string;

    targetHtml: string;

    control: TargetSelector;   // selector to the actionable seed

    controlType:               // semantic role → how the agent acts

      | 'text' | 'textarea' | 'select'

      | 'checkbox' | 'radio' | 'button' | 'link' | 'file';

    options?: { value: string; label: string }[];  // only for <select>

  }

  interface ActionableGroup {

    content: string;

    contentHtml: string;

    children: ActionableTarget[];

  }

  type ActionableTree = ActionableGroup[];

  ```

  `types.ts` is exported via `packages/shared/src/index.ts` barrel — no extra export wiring.)

### 2. `packages/extension/src/utils/actionable-tree.ts` (NEW — the algorithm)

- `export function fetchActionableTree(root: ParentNode = document.body): ActionableGroup[]`

  implementing Phases A–E above.

- Internal helpers: `resolveChildUnit(seed)`, `dedupeSmallestUnits(children)`,

  `findParent(child, childSet)`, `leftoverText(node, childSet)`, `stripChildrenHtml(parent,

  childSet`,` buildControlSelector(seed)`.

- Reuse `findElementsByTarget` / `findElementByTarget` from `@avalon/shared` for selector

  generation/verification. Follow the pure-function, named-export style of

  `packages/shared/src/matcher.ts`.

### 3. `packages/extension/src/utils/action-executor.ts` (wire the action)

- Import `fetchActionableTree`.

- Add an early-return case in `runAction` (alongside `wait` / `scroll_by`, before the

  target-required `default` block):

  ```ts

  case 'fetch_actionable_tree':

    return { tree: fetchActionableTree(document.body) };

  ```

  It returns through the existing `executeRemoteAction` → `ActionResult.data` →

  `SOCKET_EVENTS.ACTION_RESULT` path — **no new messaging/relay plumbing needed**.

### 4. `packages/frontend/src/App.tsx` (trigger + display)

- `fetch_actionable_tree` shows up automatically in the Action dropdown via

  `ACTION_DEFINITIONS`. Add a dedicated "Fetch actionable tree" button next to Execute that

  emits a `RemoteAction` with `action: 'fetch_actionable_tree'` and no target (mirror

  `clearHighlight`'s shape; use `selectedTabId` for `tabId`).

- Capture the result: in the existing `SOCKET_EVENTS.ACTION_RESULT` handler, when

  `result.data?.tree` is present, store it in new state `actionableTree`) instead of only

  logging.

- Render a new panel listing each group: `content` as a heading, then each child as a row

  showing `target` text + `controlTag`; clicking a row can prefill the Target form from

  `control` (and/or emit a `highlight` action) so the existing highlight/act flow can verify

  the selector. Keep UI minimal; reuse existing `.panel` / `.field` styling.

---

## Why this structure

- The extension is the only side with the live target DOM, and computing there means we ship

  ~a few KB of label+control descriptors instead of the full page — the user's core concern.

- Routing the tree through the existing `ActionType` → `ActionResult` machinery means zero new

  socket events, relay handlers, or message constants.

- Emitting a `TargetSelector` per control makes the tree immediately actionable by the same

  `findElementByTarget` + `action-executor` pipeline the agent already uses.

---

## Verification

1. **Build/typecheck:** `npm run build` (or `tsc -b`) across the workspace; ensure

   `@avalon/shared` rebuilds so the new types/action are visible to both consumers.

2. **Unit-test the algorithm** following `packages/shared/src/matcher.test.ts` style: feed the

   two HTML fixtures from the request (the fieldset checkboxes and the Yes/No field) into

   `fetchActionableTree` (via jsdom or a DOM-providing test env) and assert:

   - Case 1 → 1 group, `content` = "What do you want to work on? Select all that apply",

     5 children with targets "AI / Agents" … "Infrastructure / DevOps".

   - Case 2 → 1 group, `content` = "Are you legally authorized to work in the United States?",

     2 children "Yes"/"No"; the hidden checkbox does **not** appear.

   - `<select>` fixture → 1 child with `controlType: 'select'` and

     `options = [{value/label: ItemA}, ItemB, ItemC]`; its option text is absent from `content`.

3. **End-to-end:** load the extension (WXT dev), open a real Ashby application form, start the

   frontend controller, connect both on the same session, click "Fetch actionable tree", and

   confirm the rendered groups/targets match the form. Click a target row → highlight lands on

   the correct control on the page.