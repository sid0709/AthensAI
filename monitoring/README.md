# AthensAI monitoring stack

The monitoring stack runs separately from the application container and keeps Prometheus, Grafana, Alertmanager, node-exporter, cAdvisor, blackbox-exporter, redis-exporter, and stackdriver-exporter available during application rebuilds. Prometheus also scrapes Qdrant's native metrics endpoint.

Prometheus is the source of current and time-series status data. Athens-server writes only a compact Firestore fallback snapshot, incidents, and complete daily summaries. It exposes cluster-wide application and synthetic-check metrics on private port `9101`; that port is reachable only through the `athens-monitoring` Docker network.

## Credentials

`athens-monitoring-reader@drwretail-bm.iam.gserviceaccount.com` has only `roles/monitoring.viewer`. Its JSON key is installed at `/opt/athens-monitoring/secrets/monitoring-reader.json`, owned by the exporter's `65534:65534` user with mode `400`. The deployment workflow's `bootstrap_firebase_runtime` option creates and installs this key together with the application runtime key. No credential belongs in Git.

The read-only key is used by:

- stackdriver-exporter for curated Firestore and Cloud Storage Prometheus metrics;
- Grafana's Google Cloud Monitoring datasource for private operational dashboards.

## VPS deployment

```bash
mkdir -p /opt/athens-monitoring/secrets
cp monitoring/.env.example /opt/athens-monitoring/.env
chmod 600 /opt/athens-monitoring/.env
chown 65534:65534 /opt/athens-monitoring/secrets/monitoring-reader.json
chmod 400 /opt/athens-monitoring/secrets/monitoring-reader.json
docker compose --env-file /opt/athens-monitoring/.env -f /opt/athens-monitoring/docker-compose.yml up -d
```

The deployment workflow synchronizes this directory, preserves the monitoring credential, creates persistent data directories, validates the Compose configuration, and starts the stack. Alertmanager deliberately uses its `noop` receiver: alerts are visible in Prometheus and Grafana but are never sent externally.

Prometheus, Grafana, and Alertmanager data are stored in `/opt/athens-monitoring/data/`. Prometheus retains 120 days of telemetry. Grafana binds to localhost by default; use an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 user@vps`) or an authenticated HTTPS reverse proxy.

Daily Firestore summaries are written only after a closed UTC day has at least 95 percent Prometheus coverage for every public component. Legacy `monitor_samples`, `monitor_current_status`, `monitor_daily_rollups`, and `monitor_incidents` data remain untouched and are not read by the v2 status service.
