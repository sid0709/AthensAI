import { initMongo, closeMongo } from '../db/mongo.js';
import { rollupDay } from '../services/monitoring/statusStore.js';

function dateKeys(from, to) {
	const start = new Date(`${from}T00:00:00.000Z`);
	const end = new Date(`${to}T00:00:00.000Z`);
	const keys = [];
	for (const current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) keys.push(current.toISOString().slice(0, 10));
	return keys;
}

const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const from = process.argv[2] || yesterday;
const to = process.argv[3] || from;

try {
	await initMongo();
	for (const dateKey of dateKeys(from, to)) {
		await rollupDay(dateKey);
		console.log(`[monitoring] rolled up ${dateKey}`);
	}
} finally {
	await closeMongo();
}
