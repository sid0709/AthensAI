# AthensAI monitoring stack

This is intentionally separate from the Athens application container. It keeps Prometheus, Grafana, Alertmanager, node-exporter, cAdvisor, and blackbox-exporter operational even when the application image is rebuilt.

On the VPS:

```bash
mkdir -p /opt/athens-monitoring
cp monitoring/.env.example /opt/athens-monitoring/.env
cp monitoring/alertmanager/alertmanager.yml /opt/athens-monitoring/alertmanager/alertmanager.local.yml
chmod 600 /opt/athens-monitoring/.env
docker compose --env-file /opt/athens-monitoring/.env -f /opt/athens-monitoring/docker-compose.yml up -d
```

The deployment workflow synchronizes this directory to `/opt/athens-monitoring/` on every production deployment. If the optional `SLACK_WEBHOOK_URL` GitHub Actions secret exists, it generates Slack notifications automatically; otherwise Alertmanager runs without outbound notifications. Telegram is not configured.

Grafana binds to localhost by default. Use an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 user@vps`) or an authenticated HTTPS reverse proxy to access it.

Prometheus keeps scrape-resolution data for 24 hours. Athens-server writes idempotent daily summaries to MongoDB after each UTC day closes. Grafana's password is generated and persisted on the VPS unless `GRAFANA_ADMIN_PASSWORD` is supplied as an optional repository secret.
