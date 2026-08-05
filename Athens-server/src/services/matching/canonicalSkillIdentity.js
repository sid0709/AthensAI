import crypto from 'node:crypto';
import { toCanonical } from '@nextoffer/shared/skill-normalize';

/** Stable unsigned 32-bit identifier used by the Firestore skill dictionary. */
export function stableSkillId(name) {
	const canonical = toCanonical(String(name || '').trim()) || String(name || '').trim().toLowerCase();
	if (!canonical) return null;
	const value = crypto.createHash('sha256').update(canonical).digest().readUInt32BE(0);
	return value === 0 ? 1 : value;
}

export function dictionaryVersionFor(entries = []) {
	const canonical = entries
		.map((entry) => `${entry.nameCanonical || ''}:${entry.skillId ?? stableSkillId(entry.nameCanonical) ?? ''}`)
		.sort()
		.join('|');
	return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

