/** Derive Socket.IO origin from VITE_SOCKET_URL or VITE_API_URL (strip /api path). */
export function resolveSocketUrl() {
	const explicit = import.meta.env.VITE_SOCKET_URL?.trim();
	if (explicit) return explicit.replace(/\/$/, '');

	const api = import.meta.env.VITE_API_URL?.trim();
	if (!api) return null;

	try {
		const url = new URL(api);
		return `${url.protocol}//${url.host}`;
	} catch {
		return null;
	}
}
