# Athens guidelines

Follow [`UI_GUIDE.md`](UI_GUIDE.md) for visual language. Athens-lens is the role model: system sans, black primary actions, blue only as a signal, and a 1px border before shadow.

## Design system

- Tokens: `src/styles/tokens.css` (`--athens-*`)
- Primitives: `src/styles/athens-ui.css` (`.athens-toolbar`, `.athens-surface`, `.athens-tab`, `.athens-btn`, `.athens-segment`, `.athens-dock`, …)
- First consumer of lens chrome: Job Search filter + sticky toolbars. Do not remap global `--primary` until a later migration. Site typeface is San Francisco everywhere.

## Layout

- Use flexbox or grid. Avoid `overflow-x-clip` on toolbar cards; wrap or group actions instead.
- Secondary controls are at least 36–40px high. Keep 16px padding so trailing buttons are fully visible.
