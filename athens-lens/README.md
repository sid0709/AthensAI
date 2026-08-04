# Athens Lens

Athens Lens is a backend-free Chrome side-panel MVP built with React, Vite, and WXT.

The mock MVP includes job browsing and a Gmail-style inbox for opening verification emails and copying security codes. Use the **Jobs** and **Gmail inbox** workspace routes in the side panel to switch views.

## Development

```bash
npm install
npm run dev
```

WXT opens a development browser with the extension installed and reloads it as source files change. Click the Athens Lens toolbar icon to open the side panel directly.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The production extension is written to `.output/chrome-mv3/`. It can also be loaded through `chrome://extensions` with **Developer mode → Load unpacked**.

See [`docs/UI_GUIDE.md`](docs/UI_GUIDE.md) before changing components or styles.
