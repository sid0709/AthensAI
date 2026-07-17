/** Mirrors Athens frontend `isBetaTier` in `src/app/lib/beta.ts`. */
export function isBetaTier(tier) {
	return String(tier ?? '').trim().toLowerCase() === 'beta';
}
