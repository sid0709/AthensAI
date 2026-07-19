# Project Avalon

Chrome extension + shared types for remote browser control. The Socket.IO relay is a **dedicated process** (`@avalon/backend` on port **3847**, path `/avalon/socket.io`). LLM traffic goes through top-level **ai-bff**.

## Packages

| Package | Description |
|---------|-------------|
| `@avalon/shared` | Shared types, target matching, action definitions |
| `@avalon/extension` | Chrome MV3 extension (WXT + React sidebar) |
| `@avalon/backend` | Standalone Socket.IO relay (isolated from Athens-server) |

## Quick start

```bash
npm install
npm run start:relay      # Avalon relay on :3847
npm run dev:extension    # loads unpacked extension with HMR
```

Load the extension from `packages/extension/.output/chrome-mv3` (or the path WXT prints).

Default relay URL is `http://127.0.0.1:3847`. In Docker/nginx, clients still use `/avalon` (proxied to the relay).

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
