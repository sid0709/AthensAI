# Project Avalon

Chrome extension + shared types for remote browser control. The Socket.IO relay lives in **Athens-server** (`/avalon/socket.io`). LLM traffic goes through top-level **ai-bff**.

## Packages

| Package | Description |
|---------|-------------|
| `@avalon/shared` | Shared types, target matching, action definitions |
| `@avalon/extension` | Chrome MV3 extension (WXT + React sidebar) |

## Quick start

```bash
npm install
npm run dev:extension  # loads unpacked extension with HMR
```

Load the extension from `packages/extension/.output/chrome-mv3` (or the path WXT prints).

Default relay URL is `http://127.0.0.1:8979` (Athens-server).

## Target selector

Targets are matched by **tag**, **properties** (dynamic attribute patterns), and **index** (nth match).

Property patterns use `?` as a single-character wildcard:

| Pattern | Matches |
|---------|---------|
| `?__index__` | `2X6x__index__`, anything ending with `__index__` |
| `?_id_?` | `weioj_id_aiofjio`, `weioj_id_` |

## Socket events

- `register` — join as `extension` or `controller`
- `execute-action` — controller → extension
- `action-result` — extension → controller
- `tabs-update` — extension tab list
- `screenshot-result` — tab screenshot data URL
