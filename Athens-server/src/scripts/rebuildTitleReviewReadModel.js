#!/usr/bin/env node
import dotenv from 'dotenv';
import { closeRedis, initRedis } from '../db/redis.js';
import { rebuildTitleReviewReadModel } from '../services/jobTitleReview/titleReviewReadModel.js';

dotenv.config();

try {
	await initRedis({ force: true });
	const result = await rebuildTitleReviewReadModel({ force: true });
	console.log(JSON.stringify(result, null, 2));
} finally {
	await closeRedis();
}
