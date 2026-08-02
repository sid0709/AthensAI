const MAX_GENERATION_STEPS = 100;

function stepIndex(value, fallback = null) {
	const index = Number(value);
	return Number.isInteger(index) && index > 0 ? index : fallback;
}

function upsertStep(current, raw, status, fallbackIndex = null) {
	const index = stepIndex(raw?.index, fallbackIndex);
	if (!index) return current;
	const previous = current.find((step) => step.index === index);
	const nextStatus = previous?.status === 'done' ? 'done' : status;
	const next = {
		index,
		name: String(raw?.name || previous?.name || `Step ${index}`),
		purpose: String(raw?.purpose || previous?.purpose || ''),
		kind: String(raw?.kind || previous?.kind || ''),
		status: nextStatus,
		...(raw?.usage ? { usage: raw.usage } : previous?.usage ? { usage: previous.usage } : {}),
	};
	return [...current.filter((step) => step.index !== index), next]
		.sort((left, right) => left.index - right.index)
		.slice(0, MAX_GENERATION_STEPS);
}

/** Keep a cumulative, Redis-safe checklist as parallel model events arrive. */
export function mergeResumeGenerationSteps(existing, event) {
	let current = Array.isArray(existing) ? existing : [];
	if (!event || typeof event !== 'object') return current;

	if (event.phase === 'pipeline-ready' && Array.isArray(event.steps)) {
		for (let offset = 0; offset < event.steps.length && offset < MAX_GENERATION_STEPS; offset += 1) {
			current = upsertStep(current, event.steps[offset], 'pending', offset + 1);
		}
		return current;
	}

	if (event.phase === 'step-start') return upsertStep(current, event, 'running');
	if (event.phase === 'step-done') return upsertStep(current, event, 'done');
	return current;
}

/** Publish completion only after the section is durably readable by the UI. */
export async function persistResumeSectionBeforeEmit(persist, emit) {
	await persist();
	emit();
}
