# Oak Forms (Athens Lens)

Isolated port of Project Oak’s **interactive DOM capture** for Athens Lens **Ask AI**.

## What is included

- Interactive DOM serialize (open shadow roots + same-origin iframes)
- Pure-tree “Copy for Analyze” text formatting
- `injectSerializePage()` for `chrome.scripting.executeScript`

## What is not included

- Oak UI Board / Socket.io backend
- Script Eval codegen / `chrome.debugger` autofill
- iCIMS / Workday click helpers
- Stamping `data-oak-id` on the live page (Ask AI does not fill by node id yet)

## Provenance

Adapted from:

- `Oak/extension/src/content/dom-serializer.ts`
- `Oak/ui-board/src/tree-export.ts`

Keep this folder free of Lens recording / bid / resume code so the capture mechanism stays swappable.
