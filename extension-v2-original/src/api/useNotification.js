import { useSnackbar } from 'notistack';
import { useMemo, useCallback } from 'react';

export function formatFailureMessage(err, fallback = 'Something went wrong') {
	if (!err) return fallback;
	if (typeof err === 'string') return err;

	const message = err?.message || '';
	if (
		message === 'Failed to fetch' ||
		err?.name === 'TypeError' ||
		/failed to fetch|networkerror/i.test(message)
	) {
		return 'Failed to connect to backend API. Check that the server is running and VITE_API_URL is correct.';
	}
	if (message === 'API base URL is not configured') {
		return 'API base URL is not configured. Set VITE_API_URL and reload the extension.';
	}
	if (message === 'Request failed') {
		const detail = err?.data?.message || err?.data?.error;
		return detail ? `Backend request failed: ${detail}` : 'Backend request failed.';
	}

	return message || fallback;
}

const useNotification = () => {
	const { enqueueSnackbar } = useSnackbar();

	const showNotification = useCallback((message, options = {}) => {
		const {
			variant = 'default',
			autoHideDuration = 5000,
			...otherOptions
		} = options;

		enqueueSnackbar(message, {
			variant,
			autoHideDuration,
			...otherOptions,
		});
	}, [enqueueSnackbar]);

	return useMemo(() => ({
		showNotification,
		success: (message, options) =>
			showNotification(message, { variant: 'success', ...options }),
		error: (message, options) =>
			showNotification(message, { variant: 'error', ...options }),
		warning: (message, options) =>
			showNotification(message, { variant: 'warning', ...options }),
		info: (message, options) =>
			showNotification(message, { variant: 'info', ...options }),
		fail: (err, options) =>
			showNotification(formatFailureMessage(err), { variant: 'error', ...options }),
	}), [showNotification]);
};

export default useNotification;
