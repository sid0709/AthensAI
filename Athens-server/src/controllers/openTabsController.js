
export async function openTabs(req, res) {
	try {
		const { urls } = req.body || {};
		if (!Array.isArray(urls) || !urls.length) {
			return res.status(400).json({ success: false, error: 'Missing urls array' });
		}

		return res.status(410).json({
			success: false,
			error: 'Real-time open-tabs forwarding has been removed. Use the browser extension UI to open tabs directly.',
		});
	} catch (err) {
		console.error('POST /api/open-tabs error', err);
		return res.status(500).json({ success: false, error: err.message });
	}
}
