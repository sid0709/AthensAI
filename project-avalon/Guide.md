# Avalon — Avoiding Platform Hardcoding

Project Avalon is a **cross-platform job-application agent**. It must work on Greenhouse, Ashby, Lever, Workday, Deel, and forms we have never seen. This guide explains what hardcoding is in our context, why it breaks the product, and what to use instead.

## What counts as hardcoding (do not do this)

**Platform hardcoding** is special-casing a vendor, site, or CSS framework by name or class:

```typescript
// BAD — ties us to Ashby
el.closest('.ashby-application-form-field-entry')

// BAD — ties us to Greenhouse
root.querySelector('.file-upload')

// BAD — ties us to MUI / TipTap / Deel
el.closest('.MuiCheckbox-root')
el.closest('.ProseMirror')
if (label.includes('Portfolio')) ...

// BAD — overriding AI at apply time by label keyword
if (label.includes('country')) return profile.country

// BAD — re-deciding values/skip locally instead of using the AI plan
if (label.includes('salary')) value = '120000'
```

**Apply-time profile overrides** are also hardcoding: they second-guess the AI plan with local rules. The AI receives the active `autoBidProfile` at **Analyze** time and decides every value and `shouldSkip`; **Apply** only executes that decision.

> Note: dispatching a *typed, generic* op in the executor (`setValue` vs `click` vs `typeCombobox` vs `attachFile`) is **not** hardcoding — those are portable control verbs, not vendors. What's forbidden is branching on a **site/label/value**, not on a generic control type.

## What is not hardcoding (OK to use)

These are **semantic, portable** signals available on most forms:

| Signal | Example |
|--------|---------|
| HTML semantics | `form`, `fieldset`, `legend`, `label[for]`, `input[type="file"]` |
| ARIA | `role="combobox"`, `role="textbox"`, `contenteditable="true"`, `aria-labelledby` |
| Structure | Parent innerText minus child innerText; common ancestor of multiple `<form>` elements |
| Visible affordances | Button text near a hidden file input (language-based, not vendor-based) |
| AI judgment | What to fill, how to click/type, whether to skip — encoded in **generated script** |

Generic heuristics (e.g. “prefer `input[type=file]` over a sibling upload button”) are fine because they describe **roles**, not **vendors**.

## Architecture: who decides what

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  DOM analytics  │ ──► │  Actionable tree │ ──► │  AI (Analyze)   │
│  (extension)    │     │  contextText+dom │     │  values + skip  │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │  FieldActionPlan[]
                        ┌──────────────────┐              │
                        │  Build plan      │ ◄────────────┘
                        │  (deterministic) │   tree control + AI action → typed step
                        └────────┬─────────┘
                                 │  InjectionPlan (typed steps)
                        ┌────────▼─────────┐
                        │  Apply (execute) │   isolated world via helpers;
                        │  no eval, no CSP │   file set in MAIN world
                        └──────────────────┘
```

1. **`dom-analytics.ts`** — Extract fields using semantics and structure. No vendor class names.
2. **`actionable-tree.ts`** — Build grouped targets with `contextText` (parent innerText − child innerText), `targetHtml`, `controlType`, and a portable `control` selector.
3. **AI / `prompt.ts`** — Analyze: decide each value and `shouldSkip` from profile + field metadata. This is the **only** place values are chosen.
4. **`generate-injection-plan.ts`** — Deterministically map each `(AI action + controlType)` onto a typed `InjectionStep` (`setValue`/`selectOption`/`typeCombobox`/`setChecked`/`click`/`attachFile`). No AI call, no values invented here.
5. **Apply** — `injection-plan-runner.ts` executes the plan in the content script's **isolated world** using `helpers.*` (no `eval`, immune to page CSP). File inputs are tagged and filled by the background in the page's **MAIN world** (the isolated world cannot assign `input.files`).

## Apply = declarative plan execution

The AI does **not** write a script. It produces values + skip decisions at Analyze time; the plan builder turns those into typed steps; the executor runs them with portable helpers. The executor dispatches on a **generic control verb** (`setValue`, `click`, …) — never on a site, label, or value.

Helpers: `findField`, `setValue`, `setRichText`, `click`, `typeCombobox`, `setChecked`, `selectOption`, etc. File attachment is handled out-of-band in the MAIN world because Chromium ignores `input.files` set from the isolated world.

If a widget is hard to fill, fix **DOM discovery** (`dom-analytics.ts`) or the **Analyze prompt** — never add site-specific `if (deel)` or class-name checks.

## Self-healing recovery = AI-authored `execute_script` (allowed, recommended)

The **first-pass fill above stays declarative** — values + skip decisions → typed `InjectionPlan`, no scripts. That is unchanged and non-negotiable.

But when an apply **does not confirm** (validation errors, a required field the plan missed, a verification/OTP step, a soft block), a static declarative plan cannot always recover, because the fix depends on DOM state that only exists at runtime. For this **recovery path only**, the AI is **allowed and encouraged to author a JavaScript snippet** that runs via the executor's `execute_script` action (`new Function(source)()` in the page/content-script world). The recovery agent receives the **live re-scanned DOM + the previous plan + the per-step failures** and returns a corrective snippet; the loop retries up to 10× (`recover-apply.ts` + `useAvalonRelay.runRecoveryLoop`).

This is **not** a licence to hardcode. The distinction:

- ✅ The **AI authors recovery JS at runtime** by reading the live DOM it was handed (querySelector, roles, labels, aria-\*). Same code path works on any site because it derives selectors from the DOM, not from a vendor.
- ❌ **We** (contributors) still never write `if (greenhouse)`, a vendor CSS class, or a fixed label string into build-time code — not in the plan builder, not in the executor, not in the recovery prompt.

So: declarative for the first pass; AI-authored `execute_script` for dynamic recovery; vendor/site/label hardcoding forbidden everywhere, at build time, always.

## Rules for contributors

1. **Never add vendor class names** to production logic.
2. **Never add apply-time value overrides or action-type switches** — trust generated script.
3. **Add generic DOM rules** in `dom-analytics.ts` when discovery fails.
4. **Improve AI prompts** when decisions are wrong — not local label hacks.
5. **Tests may use arbitrary class names** in fixtures; production code must not depend on them.

## When you think you need hardcoding

Ask:

1. Can **ARIA or HTML semantics** express this?
2. Can a **structural rule** (parent/child innerText, sibling relationship) express this?
3. Should the **AI script** handle this from `contextText` + `dom` + profile?
4. Is this only broken on **one site**? → fix generic discovery, not add a site branch.

If all four fail, extend `dom-analytics.ts` with a portable heuristic — still no vendor strings.
