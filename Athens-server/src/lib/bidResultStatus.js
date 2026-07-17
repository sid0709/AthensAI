const REVIEW_STATUSES = new Set(["submitted", "reviewed", "rejected"]);

/**
 * Derive Bid Management UI status.
 * Prefer reviewStatus over status=skipped (rejected-from-skip must show Rejected).
 */
export function deriveBidUiStatus(task) {
	if (task?.reviewStatus && REVIEW_STATUSES.has(task.reviewStatus)) {
		return task.reviewStatus;
	}
	if (task?.progress === "skipped" || task?.status === "skipped") {
		return "skipped";
	}
	if (task?.progress === "completed" || task?.status === "done") {
		return "submitted";
	}
	if (task?.bidderInProcess) {
		return "in_process";
	}
	return "pending";
}

export { REVIEW_STATUSES };
