# Docker usage

## CI/CD (GitHub Actions)

Workflow: [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)

| Event | Build & push to Docker Hub | Deploy to VPS |
|-------|----------------------------|---------------|
| PR opened/updated → `main`/`master`/`stage` | Yes (`:pr-N`, `:pr-N-<sha>`) | No |
| Push / merge to `main`/`master` | Yes (`:latest`, `:sha-<sha>`, …) → **Production** | Yes (immutable `:sha-<sha>`) |
| Push / merge to `stage` | Yes (`:stage`, `:sha-<sha>`, …) → **Stage** | Yes (immutable `:sha-<sha>`) |
| Manual `workflow_dispatch` | Yes (tags follow the branch you run from) | Yes |

Deploy SSHs into the VPS for the matching GitHub Environment, syncs [`docker/deploy-remote.sh`](docker/deploy-remote.sh), pulls the application image, recreates container `nextoffer`, and waits for athens-backend `/readyz` plus public `/api/status/current`.

### Required GitHub Environment secrets

Repo **Settings → Environments** → **Production** (for `main`/`master`) and **Stage** (for `stage`):

| Secret | Purpose |
|--------|---------|
| `DOCKERHUB_USERNAME` | Docker Hub user (e.g. `omnimuh730`) |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `VPS_HOST` | VPS IP / hostname |
| `VPS_USER` | SSH user (e.g. `root`) |
| `VPS_SSH_KEY` | Private ed25519 key authorized on the VPS |

Optional: `VPS_SSH_PORT` (default `22`), `PUBLIC_ORIGIN` for extension bake URLs (different per environment when Stage and Production use different hosts), repo variable `DOCKER_IMAGE` (default `omnimuh730/nextoffer`).

Restrict each environment’s **Deployment branches** to the matching branch (`main` for Production, `stage` for Stage).

Also add a branch rule **`refs/pull/*/merge`** on both environments so pull-request **Build & push** jobs can read that environment’s secrets. Without it, PR checks fail immediately with “Branch refs/pull/N/merge is not allowed to deploy…”. VPS deploy still only runs on push to `stage` / `main`.

App secrets (`DATABASE_URL`, Firebase credentials, encryption key) live only on each VPS in `/opt/nextoffer/deploy.env` — see [`docker/deploy.env.example`](docker/deploy.env.example). Do not put them in GitHub Actions.

### Rollback

On the VPS (or via SSH):

```bash
/opt/nextoffer/deploy.sh sha-<oldshortsha>
```

Or re-run a previous successful **Docker publish** workflow from the Actions UI (`workflow_dispatch`) on the same branch.

---

## Push to Docker Hub (manual)

```bash
./docker/publish.sh 1.0.13 --amd64
```

## Run on VPS (manual)

Prefer the deploy script (same command CI uses):

```bash
/opt/nextoffer/deploy.sh latest
# or
/opt/nextoffer/deploy.sh sha-<shortsha>
```

Container nginx (host port **9030** → container **80**) routes:

| Path | Service |
|------|---------|
| `/` | Athens SPA |
| `/api/` | athens-backend REST API (`:8980`) |
| `/personal/` | Rewritten to athens-backend `/api/personal/` |
| `/healthz`, `/readyz` | athens-backend liveness/readiness |
| `/downloads/` | Chrome extension zips (Apps & Plugins) |

Chrome extensions baked in CI must use this public origin (default
`http://$VPS_HOST:9030`). Optional secret `PUBLIC_ORIGIN` overrides it when you
terminate TLS on a hostname (e.g. `https://athensai.remotepairnet.net`).

Published container ports: **80** (nginx), **8980** (API), **9101** (Prometheus metrics on the monitoring Docker network).

## Host nginx (HTTPS → container)

Point TLS at **9030** for the SPA. Prefer proxying `/api/` (and health) to **8980** directly, matching [`docker/athensai-host-nginx.conf`](docker/athensai-host-nginx.conf).

Then reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Verify

```bash
curl -sS http://127.0.0.1:8980/readyz
curl -sS http://127.0.0.1:9030/api/status/current
docker exec nextoffer supervisorctl status athens-backend
```
