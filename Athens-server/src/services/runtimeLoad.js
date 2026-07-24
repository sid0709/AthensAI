let lastForegroundActivityAt = Date.now();

export function markForegroundActivity() {
	lastForegroundActivityAt = Date.now();
}

export function isForegroundBusy(graceMs = Number(process.env.BACKGROUND_IDLE_GRACE_MS || 60_000)) {
	return Date.now() - lastForegroundActivityAt < Math.max(1_000, Number(graceMs) || 60_000);
}
