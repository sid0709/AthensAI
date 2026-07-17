export function escapeRegexLiteral(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeSearchText(value, { maxLength = 200 } = {}) {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (trimmed.length > maxLength) return trimmed.slice(0, maxLength);
	return trimmed;
}

export function buildMongoCaseInsensitiveRegexFilter(value, { exact = false, maxLength = 200 } = {}) {
	const normalized = normalizeSearchText(value, { maxLength });
	if (!normalized) return null;
	const escaped = escapeRegexLiteral(normalized);
	const pattern = exact ? `^${escaped}$` : escaped;
	return { $regex: pattern, $options: 'i' };
}

export function buildSafeRegExp(value, flags = 'i', { exact = false, maxLength = 200 } = {}) {
	const normalized = normalizeSearchText(value, { maxLength });
	if (!normalized) return null;
	const escaped = escapeRegexLiteral(normalized);
	const pattern = exact ? `^${escaped}$` : escaped;
	return new RegExp(pattern, flags);
}

export function buildRegexAlternation(values, { maxItems = 50, maxLength = 100 } = {}) {
	if (!Array.isArray(values)) return '';
	const parts = [];
	for (const value of values) {
		const normalized = normalizeSearchText(value, { maxLength });
		if (!normalized) continue;
		parts.push(escapeRegexLiteral(normalized));
		if (parts.length >= maxItems) break;
	}
	return parts.join('|');
}

