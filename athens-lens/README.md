# Athens Lens

Athens Lens is a Chrome side-panel app built with React, Vite, and WXT.

Authentication, Bid Ready jobs, and the recent Gmail inbox use Athens-server. Sign-in accepts an Athens profile username plus that profile's vendor access password. Gmail reads the profile's configured email and Google app password server-side; those credentials are never sent to the extension. Bid recording and AI form answers remain simulated in this MVP.

Jobs and Gmail use an account-scoped Zustand cache persisted asynchronously through WXT local storage. Cached lists paint immediately and then revalidate in the background; successful server responses always replace cached data. Gmail fetches lightweight envelopes first, then loads the selected message and the remaining recent bodies in separate deduplicated batches.

## Development

```bash
npm install
npm start --prefix ../Athens-server
npm run dev
```

WXT opens a development browser with the extension installed and reloads it as source files change. Click the Athens Lens toolbar icon to open the side panel directly.

The local API defaults to `http://127.0.0.1:8979/api`. To target another server, copy `.env.example` to `.env`, set `WXT_ATHENS_API_URL`, and rebuild so Chrome receives the matching host permission.

Before signing in, enable **Vendor access** and set a vendor access password for the profile in Athens Settings. Redis must be available because Athens Lens sessions are opaque, expiring server sessions.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The production extension is written to `.output/chrome-mv3/`. It can also be loaded through `chrome://extensions` with **Developer mode → Load unpacked**.

See [`docs/UI_GUIDE.md`](docs/UI_GUIDE.md) before changing components or styles.
