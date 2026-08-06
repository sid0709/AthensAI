# athens-backend

NestJS + Prisma API for Athens. Replaces `Athens-server` for the Athens app, starting with authentication against MongoDB `AthensDB.account_info`.

**Engineering rules:** read [`rule.md`](rule.md) before changing this package (small files, no hardcoding, Nest/Prisma practice, no default test suites).

## Stack

- NestJS 11
- Prisma 6 (schema + index management for MongoDB `AthensDB`)
- Native `mongodb` driver for `account_info` reads/writes (Prisma Client writes require a replica set; this host is standalone)
- bcrypt (cost 10, same as Athens-server)
- TypeScript as the primary safety net (`npm run build` / lint) — do not add Jest/spec files unless explicitly requested

## Setup

```bash
cp .env.example .env
# Set DATABASE_URL to your Mongo host with database name AthensDB
npm install
npm run prisma:generate
npm run start:dev
```

Default listen: `http://127.0.0.1:8980/api`

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run start:dev` | Watch mode API |
| `npm run build` | Typecheck + compile (default verification) |
| `npm run lint` | ESLint |
| `npm run prisma:generate` | Regenerate Prisma Client after schema changes |
| `npm run prisma:push` | Push schema to Mongo (dev) |

## Auth contract (Athens-compatible)

| Method | Path | Body |
|--------|------|------|
| POST | `/api/auth/signin` | `{ name, password }` |
| POST | `/api/auth/signup` | `{ name, password }` |
| POST | `/api/auth/change-password` | `{ name, currentPassword, newPassword }` |
| GET | `/api/account_info` | — |
| GET | `/api/account_info/by/:name` | — |

Sign-in / sign-up responses: `{ success, user: { _id, name, tier, permission }, message }`.

## Layout

```text
src/
  auth/           # sign-in, sign-up, password
  account-info/   # account_info reads
  prisma/         # PrismaModule / PrismaService
  common/         # shared filters / pipes
prisma/
  schema.prisma   # sole DB shape source of truth
```

Keep feature folders thin and split files when they grow — see `rule.md`.
