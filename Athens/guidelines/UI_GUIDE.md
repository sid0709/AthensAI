# Athens UI Guide

Athens uses the quiet, neutral visual language of Athens Lens, adapted for the web app. Lens is the role model: system sans, black primary actions, blue only as a signal, and a 1px border before shadow. This guide is the product design language. Job Search toolbars are the first consumer; other surfaces keep the existing shadcn theme until they opt in.

Do not copy ChatGPT branding, text, or proprietary assets.

## Principles

1. **Calm before decorative.** Prefer whitespace, typography, and alignment over extra containers or color.
2. **Chrome feels native.** Toolbars and list headers use a subtle hover or selected fill rather than heavy card shadows.
3. **Content stays readable.** Body copy uses 14px with a comfortable line height. Headings use 600 weight and slightly negative letter spacing.
4. **Brand is a signal, not a surface.** Athens blue is reserved for keyboard focus and sparse highlights. Primary actions remain neutral black.
5. **Behavior comes from contracts.** UI never branches on employers, titles, locations, or description keywords.
6. **One language, scoped adoption.** Surfaces that opt in use `--athens-*` tokens and `.athens-*` primitives. Do not remap the global shadcn `--primary` or drop Figtree app-wide until a later migration.

## Tokens

All reusable visual values live in `src/styles/tokens.css` as `--athens-*` custom properties. Opt-in components must consume those properties rather than introduce competing colors, spacing, radii, typography, shadows, or timing values.

- Canvas: `#ffffff`
- Subtle surface: `#f7f7f7`
- Primary text: `#0d0d0d`
- Secondary text: `#5d5d5d`
- Muted text: `#8e8e8e`
- Border: `#dedede`
- Brand/focus: `#1f6feb`
- Danger: `#c0362c`
- Spacing: 4px base scale from 4px through 48px
- Radii: 8px, 12px, 16px, 24px, and pill
- Type: system sans (`ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`) — not Figtree
- Motion: 150ms ease; remove meaningful transitions for reduced-motion users

Dark mode maps the same roles onto the existing Athens dark neutrals. One-off layout geometry may be local when it has no reusable semantic meaning. New repeated values must become tokens.

## Layout and responsiveness

- Toolbar cards use 16px padding so trailing controls are never clipped.
- Prefer wrapping and shrinking over `overflow-x-clip` on chrome. Horizontal scroll is allowed only for status tabs, inside the padded tab row.
- Secondary and icon controls are at least 36–40px high. Do not use 32px compact buttons in opted-in chrome.
- Dense action rows group by intent (destinations, résumés, trailing) and collapse secondary groups before they overflow.
- Selection-only command strips stay hidden until a selection (or an in-flight bulk job) exists.

## Components and states

Primitives live in `src/styles/athens-ui.css`. Use these class names rather than one-off Tailwind color/radius recipes in opted-in chrome.

| Primitive | Role |
|---|---|
| `.athens-toolbar` | Scope: system font, inherited by descendants |
| `.athens-surface` | Raised card: white, 1px border, 12px radius, light control shadow |
| `.athens-tab` | Status tab; selected = subtle fill, not a brand underline |
| `.athens-count` | Neutral count pill |
| `.athens-badge` | Black count badge on filters and AI |
| `.athens-field` | 40px search field, 8px radius, brand-blue focus ring |
| `.athens-chip` | Dismissible filter chip |
| `.athens-btn` | Compact secondary: 40px, 8px radius, 1px border |
| `.athens-btn-danger` | Destructive text/border action |
| `.athens-segment` | Equal-width grouped destinations |
| `.athens-select-trigger` / `.athens-select-content` | Combobox: 8px radius, gray selected fill, never purple |
| `.athens-sheet` | Right drawer: white canvas, 16px padding, black Done |
| `.athens-card` / `.athens-card-grid` | Job card and equal-height block grid |
| `.athens-dialog` | View JD modal: no brand gradient |
| `.athens-btn-primary` | Black fill CTA (Apply, Done) |
| `.athens-chip` | Neutral skill and meta chips |
| `.athens-status` | Status pill with a color dot plus label |

- Raised surfaces use a 1px neutral border before adding shadow.
- Every interactive element needs default, hover, active where useful, disabled where applicable, and `:focus-visible` states.
- Status color dots may remain as a secondary cue; labels and selected fill must also communicate state.
- Loading, empty, and error states use concise language and the same neutral surface hierarchy.

## Typography and icons

- Use the system sans-serif stack on opted-in surfaces. Do not load additional display fonts for chrome.
- Body copy uses 14px. Tab and chip labels may use 12px.
- Use Lucide icons at 16–20px with their default outline style. Decorative icons must be hidden from assistive technology.

## Accessibility checklist

- Preserve semantic headings, lists, navigation, forms, and toolbars.
- Keep visible labels on inputs; placeholders never replace labels.
- Use `aria-current` for the selected status tab and explicit accessible names on icon-only buttons.
- Maintain visible two-pixel focus rings and logical keyboard order.
- Meet WCAG AA contrast for text and controls, and never rely on color alone to communicate state.
