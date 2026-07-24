/**
 * Compatibility hooks retained for callers that used to enqueue Cloud Tasks.
 * Data-only deployments always run the owning workers in the VPS process, so
 * writing the local pending state is sufficient and no remote task is created.
 */
export function cloudTasksEnabled() {
	return false;
}

export async function enqueueAthensTask() {
	return null;
}

export function enqueueJobAnalysisTask() {
	return Promise.resolve(null);
}

export function enqueueMatchScoreTask() {
	return Promise.resolve(null);
}

export function enqueueSearchOutboxTask() {
	return Promise.resolve(null);
}
