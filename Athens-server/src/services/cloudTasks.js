import { CloudTasksClient } from "@google-cloud/tasks";

let client;

function config() {
	const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
	const location = process.env.CLOUD_TASKS_LOCATION || "us-east4";
	const baseUrl = String(process.env.ATHENS_INTERNAL_URL || "").replace(/\/$/, "");
	const serviceAccountEmail = String(process.env.TASK_SERVICE_ACCOUNT_EMAIL || "").trim();
	return { project, location, baseUrl, serviceAccountEmail };
}

export function cloudTasksEnabled() {
	const value = config();
	return Boolean(value.project && value.baseUrl && value.serviceAccountEmail && process.env.BACKGROUND_WORKERS_MODE === "tasks");
}

export async function enqueueAthensTask(queue, path, body = {}, taskId = "") {
	if (!cloudTasksEnabled()) return null;
	const { project, location, baseUrl, serviceAccountEmail } = config();
	client ||= new CloudTasksClient();
	const parent = client.queuePath(project, location, queue);
	const task = {
		httpRequest: {
			httpMethod: "POST",
			url: `${baseUrl}${path}`,
			headers: { "Content-Type": "application/json" },
			body: Buffer.from(JSON.stringify(body)).toString("base64"),
			oidcToken: { serviceAccountEmail, audience: baseUrl },
		},
	};
	if (taskId) task.name = client.taskPath(project, location, queue, taskId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 500));
	try {
		const [created] = await client.createTask({ parent, task });
		return created.name;
	} catch (error) {
		if (Number(error?.code) === 6) return null;
		throw error;
	}
}

export function enqueueJobAnalysisTask(jobId) {
	return enqueueAthensTask("job-analysis", "/internal/tasks/job-analysis", { jobId }, `job-analysis-${jobId}`);
}

export function enqueueMatchScoreTask(key = Date.now()) {
	return enqueueAthensTask("match-scores", "/internal/tasks/match-scores", {}, `match-scores-${key}`);
}

export function enqueueSearchOutboxTask(key = Date.now()) {
	return enqueueAthensTask("search-outbox", "/internal/tasks/search-outbox", {}, `search-outbox-${key}`);
}
