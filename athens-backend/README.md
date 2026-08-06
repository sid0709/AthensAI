# athens-backend

NestJS + Prisma API for Athens. Replaces `Athens-server` for the Athens app, starting with authentication and Settings auto-bid profile against MongoDB `AthensDB.account_info`.

## Stack

- NestJS 11
- Prisma 6 (MongoDB — Prisma 7 does not support Mongo yet)
- bcrypt cost 10 (Athens-server contract)
- Acceptance criteria: [`athens-backend-rules.md`](athens-backend-rules.md)

## Setup

```bash
cp .env.example .env
# Set DATABASE_URL — database name must be AthensDB
npm install
npm run prisma:generate
npm run start:dev
```

Default listen: `http://127.0.0.1:8980/api`

### Mongo notes

- Schema and indexes: `prisma/schema.prisma` + `npm run prisma:push`
- Reads use typed Prisma Client via `PrismaService`
- Standalone Mongo (no replica set) cannot run Prisma transactional writes; `AccountInfoRepository` falls back to `$runCommandRaw` for create/password update only. Prefer enabling a replica set in production so typed writes succeed.

## Auth contract (Athens-compatible)

| Method | Path | Body |
|--------|------|------|
| POST | `/api/auth/signin` | `{ name, password }` |
| POST | `/api/auth/signup` | `{ name, password }` |
| POST | `/api/auth/change-password` | `{ name, currentPassword, newPassword }` |
| GET | `/api/account_info` | — |
| GET | `/api/account_info/by/:name` | — |

Sign-in / sign-up responses: `{ success, user: { _id, name, tier, permission }, message }`.

## Profile contract (Athens-compatible)

| Method | Path | Notes |
|--------|------|------|
| GET | `/api/personal/auto-bid-profile?applierName=&profileId=` | Returns `{ success, accountExists, vendorAllowed, vendorPasswordSet, profile }` |
| PUT | `/api/personal/auto-bid-profile` | Body: `{ applierName, profileId?, vendorAllowed?, ...profileFields }` |

Profile secrets (`openaiApiKey`, `deepseekApiKey`, `gmailAppPassword`, `defaultPassword`, …) use local `enc:v1:` via `API_KEYS_ENCRYPTION_KEY` only.

| Method | Path | Notes |
|--------|------|------|
| GET | `/api/personal/llm-models?provider=&applierName=&profileId=` | OpenAI catalog (needs decrypted profile key) or DeepSeek fixed list |
| POST | `/api/personal/default-model` | `{ applierName, provider, model, profileId? }` — validates key then saves |
| POST | `/api/personal/llm-key-check` | `{ provider, apiKey?, applierName? }` |

## Verify

```bash
npm run build
npm run lint
```
