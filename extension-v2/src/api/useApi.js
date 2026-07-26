import { useState, useCallback, useMemo } from 'react';

// Minimal useApi hook for GET/POST JSON requests with loading/error state
export default function useApi(baseUrl = import.meta.env.VITE_API_URL) {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(null);

	const resolvedBaseUrl = useMemo(() => {
		if (!baseUrl) return null;
		const trimmed = String(baseUrl).trim();
		if (!trimmed) return null;
		return trimmed.replace(/\/$/, '');
	}, [baseUrl]);

	const buildUrl = useCallback((path) => {
		if (!path) throw new Error('Missing request path');
		if (/^https?:\/\//i.test(path)) return path;
		if (!resolvedBaseUrl) throw new Error('API base URL is not configured');
		return `${resolvedBaseUrl}/${path.replace(/^\//, '')}`;
	}, [resolvedBaseUrl]);

	const request = useCallback(async (path, options = {}) => {
		setLoading(true);
		setError(null);
		let timeoutId = null;
		try {
			const url = buildUrl(path);
			const { headers: optHeaders, body, timeoutMs, signal, ...rest } = options;
			const timeoutController = timeoutMs && !signal ? new AbortController() : null;
			if (timeoutController) {
				timeoutId = setTimeout(() => timeoutController.abort(), Math.max(1, Number(timeoutMs)));
			}
			const res = await fetch(url, {
				...rest,
				signal: signal || timeoutController?.signal,
				headers: {
					'Content-Type': 'application/json',
					// Lets Athens-server stamp job_market.version = "v2" even if body is stripped.
					'X-Athens-Client': 'extension-v2',
					...(optHeaders || {}),
				},
				body: body && typeof body !== 'string' ? JSON.stringify(body) : body,
			});
			const text = await res.text();
			// Try parse JSON, fallback to text
			let data = text;
			try { data = text ? JSON.parse(text) : null; } catch (e) {
				console.error('Failed to parse response as JSON', e);
			}
			if (!res.ok) {
				const err = new Error('Request failed');
				err.status = res.status;
				err.data = data;
				throw err;
			}
			setLoading(false);
			return data;
		} catch (err) {
			const failure = err?.name === 'AbortError' && options.timeoutMs
				? new Error(`Backend request timed out after ${Math.round(Number(options.timeoutMs) / 1000)} seconds`)
				: err;
			setError(failure);
			setLoading(false);
			throw failure;
		} finally {
			if (timeoutId) clearTimeout(timeoutId);
		}
	}, [buildUrl]);

	const get = useCallback((path) => request(path, { method: 'GET' }), [request]);
	const post = useCallback((path, body, options = {}) => request(path, { ...options, method: 'POST', body }), [request]);

	return { loading, error, get, post, request, baseUrl: resolvedBaseUrl };
}
