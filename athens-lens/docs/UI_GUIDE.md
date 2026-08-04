# Athens Lens UI Guide

Athens Lens uses the quiet, neutral visual language of the ChatGPT desktop reference while adapting its navigation-and-content composition to a resizable Chrome side panel. It does not copy ChatGPT branding, text, or proprietary assets.

## Principles

1. **Calm before decorative.** Prefer whitespace, typography, and alignment over extra containers or color.
2. **Navigation feels native.** Job rows are compact, left-aligned, and use a subtle hover or selected fill rather than card shadows.
3. **Content stays readable.** Detail text uses a constrained measure, relaxed body line height, and clear section rhythm.
4. **Brand is a signal, not a surface.** Athens blue is reserved for the logo and keyboard focus. Primary actions remain neutral black.
5. **Behavior comes from contracts.** Components render the `Job` and `Session` contracts and never branch on employers, titles, locations, or description keywords.

## Tokens

All reusable visual values live in `src/styles/tokens.css`. Components must consume those custom properties rather than introduce competing colors, spacing, radii, typography, shadows, or timing values.

- Canvas: `#ffffff`
- Navigation: `#ffffff`; use neutral-gray hover and selected fills only
- Subtle surface: `#f7f7f7`
- Primary text: `#0d0d0d`
- Brand/focus: `#1f6feb`
- Spacing: 4px base scale from 4px through 48px
- Radii: 8px, 12px, 16px, 24px, and pill
- Motion: 150ms ease; remove meaningful transitions for reduced-motion users

One-off layout geometry may be local when it has no reusable semantic meaning. New repeated values must become tokens.

## Layout and responsiveness

- Below 560px, navigation and detail are separate full-width panes. Selecting a job opens detail; **All jobs** returns to the list.
- At 560px and wider, navigation is fixed at 220px and detail fills the remaining width. The selected job stays visible in both panes.
- At 760px and wider, navigation becomes 244px and the detail metadata can use three columns.
- Both the job list and detail body own their scrolling regions. Headers and footers remain fixed.
- Avoid horizontal scrolling down to the supported 320px minimum width.

## Components and states

- Navigation rows use 12px padding, a 12px radius, an 8% neutral selected fill, and no outer card border.
- Inputs and primary controls are 48px high. Secondary and icon controls are at least 36–40px high.
- Raised surfaces use a 1px neutral border before adding shadow.
- Every interactive element needs default, hover, active where useful, disabled where applicable, and `:focus-visible` states.
- Loading, empty, and error states use concise language and the same neutral surface hierarchy.

## Typography and icons

- Use the system sans-serif stack; do not load remote fonts from extension pages.
- Headings use 600 weight and slightly negative letter spacing. Body copy uses 14px with comfortable line height.
- Use Lucide icons at 16–20px with their default outline style. Decorative icons must be hidden from assistive technology.

## Accessibility checklist

- Preserve semantic headings, lists, navigation, forms, and definition lists.
- Keep visible labels on inputs; placeholders never replace labels.
- Use `aria-current` for the selected job and explicit accessible names on icon-only buttons.
- Maintain visible two-pixel focus rings and logical keyboard order.
- Meet WCAG AA contrast for text and controls, and never rely on color alone to communicate state.
