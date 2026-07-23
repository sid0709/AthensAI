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

The deployment workflow synchronizes this directory to `/opt/athens-monitoring/` on every production deployment. During that SSH step it checks for Docker and Docker Compose, installs missing packages through `apt` or `dnf`, starts Docker, creates the persistent data directories, and starts the monitoring stack. If the optional `SLACK_WEBHOOK_URL` GitHub Actions secret exists, it generates Slack notifications automatically; otherwise Alertmanager runs without outbound notifications. Telegram is not configured.

Prometheus, Grafana, and Alertmanager data are stored in `/opt/athens-monitoring/data/` on the VPS. The Prometheus retention setting disables automatic time-based deletion, so data survives container recreation and deployment. Monitor disk usage and manually archive or delete old data when the VPS approaches capacity.

Grafana binds to localhost by default. Use an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 user@vps`) or an authenticated HTTPS reverse proxy to access it.

Athens-server writes idempotent daily summaries to MongoDB after each UTC day closes. Grafana's password is generated and persisted on the VPS unless `GRAFANA_ADMIN_PASSWORD` is supplied as an optional repository secret.
