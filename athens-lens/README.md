# Athens Lens

Athens Lens is a backend-free Chrome side-panel MVP built with React, Vite, and WXT.

The mock MVP includes job browsing, a Gmail-style inbox for verification codes, and a simulated bid-recording workflow. **Apply & record** opens the mock job URL and starts a persistent demo MP4 timer; users can restart it, ask for mock AI form answers, complete the bid, and record whether it was submitted.

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
