# Docker usage

## CI/CD (GitHub Actions)

Workflow: [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)

| Event | Build & push to Docker Hub | Deploy to VPS |
|-------|----------------------------|---------------|
| PR opened/updated → `master` | Yes (`:pr-N`, `:pr-N-<sha>`) | No |
| Push / merge to `master` | Yes (`:latest`, `:sha-<sha>`, …) | Yes (immutable `:sha-<sha>`) |
| Manual `workflow_dispatch` | Yes (same as master) | Yes |

Deploy SSHs into the VPS, syncs [`docker/deploy-remote.sh`](docker/deploy-remote.sh) and [`docker/ranking-compose.yml`](docker/ranking-compose.yml), provisions Redis and Qdrant when missing, pulls the application image, recreates container `nextoffer`, and waits for all required health checks.

Redis and Qdrant run only on the private `athens-monitoring` Docker network. Their data is stored in the named volumes `nextoffer-redis-data` and `nextoffer-qdrant-data`; application redeploys, container recreation, and normal VPS reboots preserve both volumes. Redis uses AOF persistence, Qdrant writes its collections to its storage volume, and every container uses `restart: unless-stopped`.

The first deployment automatically backfills the ranking index from the authoritative database and records a completion marker in persistent Redis. Later deployments reuse the existing index. Do not run `docker compose down -v`, `docker volume rm`, or volume-pruning commands unless you intentionally want to erase these local indexes; Firestore remains the authoritative job data source and can rebuild them if necessary.

### Required GitHub secrets

Repo **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|--------|---------|
| `DOCKERHUB_USERNAME` | Docker Hub user (e.g. `omnimuh730`) |
| `DOCKERHUB_TOKEN` | Docker Hub access token |
| `VPS_HOST` | VPS IP / hostname |
| `VPS_USER` | SSH user (e.g. `root`) |
| `VPS_SSH_KEY` | Private ed25519 key authorized on the VPS |

Optional: `VPS_SSH_PORT` (default `22`), repo variable `DOCKER_IMAGE` (default `omnimuh730/nextoffer`).

App secrets (Firebase credentials and the encryption key) live only on the VPS in `/opt/nextoffer/deploy.env` — see [`docker/deploy.env.example`](docker/deploy.env.example). Do not put them in GitHub Actions.

### Rollback

On the VPS (or via SSH):

```bash
/opt/nextoffer/deploy.sh sha-<oldshortsha>
```

Or re-run a previous successful **Docker publish** workflow from the Actions UI (`workflow_dispatch`).

---

## Push to Docker Hub (manual)

```bash
cd /Users/robin/Desktop/Utils/NextOffer
./docker/publish.sh 1.0.13 --amd64
```

## Run on VPS (manual)

Prefer the deploy script (same command CI uses):

```bash
/opt/nextoffer/deploy.sh latest
# or
/opt/nextoffer/deploy.sh sha-<shortsha>
```

Do not replace this with a standalone `docker run`: the deploy script also starts and verifies Redis/Qdrant, connects the application to their private network, preserves their volumes, and performs the first ranking backfill.

Container nginx (port **9030**) already routes:

| Path | Service |
|------|---------|
| `/` | Athens SPA |
| `/api/`, `/personal/`, `/socket.io/` | Athens-server |
| `/avalon/` | Avalon relay process (`@avalon/backend` on :3847) |
| `/ai-bff/` | ai-bff |
| `/downloads/` | Chrome extension zips (Apps & Plugins) |

Chrome extensions baked in CI must use this public origin (default
`http://$VPS_HOST:9030`). Optional secret `PUBLIC_ORIGIN` overrides it when you
terminate TLS on a hostname (e.g. `https://sid.example.com`). Do **not** point
extensions at `:3847` — that port is not published. Bake `WXT_AVALON_RELAY_URL`
as the **origin only** (no `/avalon` path); the Engine.IO path is always
`/avalon/socket.io` on the web port.

## Host nginx (HTTPS → container)

Athens connects to `wss://<host>/avalon/socket.io/`. If the host proxy only forwards plain HTTP (no WebSocket upgrade), the browser floods `WebSocket connection … failed` errors while the rest of the UI still works.

Point TLS at **9030** and enable upgrades for the whole upstream (or at least `/avalon/` and `/socket.io/`):

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name sid.remotepairnet.net;

    # ssl_certificate / ssl_certificate_key … (your existing certs)

    # Bid Monitor base64 video uploads — keep in sync with docker/nginx.conf (~4GB)
    client_max_body_size 4096m;

    location / {
        proxy_pass http://127.0.0.1:9030;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for Avalon (/avalon/socket.io) and Athens-server (/socket.io)
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

Then reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### Verify

```bash
# Relay HTTP path through the public host
curl -sS https://sid.remotepair.net/avalon/health

# Same check hitting the container directly (bypasses host nginx)
curl -sS http://127.0.0.1:9030/avalon/health

# Avalon process inside the container
docker exec nextoffer supervisorctl status avalon-relay
```

- If **9030** health works but **HTTPS** fails → fix host nginx (snippet above).
- If **9030** health fails → `docker logs nextoffer` / restart `avalon-relay`.
- After a good health response, hard-refresh the app; the Avalon WebSocket errors should stop.
