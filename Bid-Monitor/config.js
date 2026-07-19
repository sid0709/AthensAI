/**
 * Bid Monitor runtime config.
 *
 * Local (load unpacked): set ATHENS_API_URL in Bid-Monitor/.env, then:
 *   ./apply-env.sh
 *
 * Pack / Docker: pack-extension.sh bakes ATHENS_API_URL from env /
 * PUBLIC_ORIGIN (CI uses secrets.VPS_HOST). Local .env is ignored in CI.
 */
const BidMonitorConfig = Object.freeze({
  /** Athens-server REST API base (include /api suffix). */
  ATHENS_API_URL: 'http://127.0.0.1:8979/api',
});
