export const JOB_STATUS_STATES = Object.freeze([
	'applied',
	'scheduled',
	'declined',
	'bid-ready',
	'bid-completed',
]);

export function emptyJobStatusBaseline() {
	return Object.fromEntries(JOB_STATUS_STATES.map((state) => [state, []]));
}

