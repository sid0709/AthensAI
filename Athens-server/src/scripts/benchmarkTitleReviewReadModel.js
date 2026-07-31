#!/usr/bin/env node
import {
	finalizeTitleReviewSnapshot,
	titleReviewReadModelTest,
} from '../services/jobTitleReview/titleReviewReadModel.js';

const TOTAL_ROWS = Math.max(1_000, Number(process.env.TITLE_REVIEW_BENCHMARK_ROWS || 15_000));
const REVIEW_ROWS = Math.min(TOTAL_ROWS, Number(process.env.TITLE_REVIEW_BENCHMARK_REVIEW_ROWS || 3_500));
const FAILED_ROWS = Math.min(TOTAL_ROWS - REVIEW_ROWS, 500);
const LIVE = process.argv.includes('--live');
const LIVE_BASE_URL = String(process.env.TITLE_REVIEW_BENCHMARK_URL || 'http://localhost:8979/api/jobs/title-review');
const APPLIER_NAME = String(process.env.TITLE_REVIEW_BENCHMARK_APPLIER || 'Oliver Baltay');

function percentile(values, fraction) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] || 0;
}

function summarize(name, values) {
	return {
		name,
		runs: values.length,
		minMs: Number(Math.min(...values).toFixed(2)),
		medianMs: Number(percentile(values, 0.5).toFixed(2)),
		p95Ms: Number(percentile(values, 0.95).toFixed(2)),
		maxMs: Number(Math.max(...values).toFixed(2)),
	};
}

async function measure(name, runs, operation) {
	const durations = [];
	for (let index = 0; index < runs; index += 1) {
		const startedAt = performance.now();
		await operation(index);
		durations.push(performance.now() - startedAt);
	}
	return summarize(name, durations);
}

function fixtureRows() {
	return Array.from({ length: TOTAL_ROWS }, (_, index) => {
		const reviewRequired = index < REVIEW_ROWS;
		const failed = !reviewRequired && index < REVIEW_ROWS + FAILED_ROWS;
		const pending = !reviewRequired && !failed;
		return {
			id: `benchmark-${String(index).padStart(5, '0')}`,
			title: index % 17 === 0 ? `MuleSoft Developer ${index}` : `Software Engineer ${index}`,
			company: `Company ${index % 250}`,
			source: index % 2 ? 'LinkedIn' : 'Workday',
			postedAt: new Date(Date.UTC(2026, index % 12, 1 + (index % 28))).toISOString(),
			applyUrl: `https://example.test/jobs/${index}`,
			titleReview: {
				processingState: failed ? 'failed' : pending ? 'pending' : 'completed',
				label: reviewRequired ? 'REVIEW_REQUIRED' : undefined,
				confidence: reviewRequired ? (index % 101) / 100 : undefined,
				reason: reviewRequired ? 'Benchmark review reason.' : undefined,
				error: failed ? { code: 'BENCHMARK', message: 'Synthetic failure.' } : undefined,
			},
		};
	});
}

function inMemoryList(snapshot, options) {
	return titleReviewReadModelTest.listFromSnapshot(
		snapshot,
		options,
		'memory',
		{ startedAt: performance.now(), cacheLookupMs: 0 },
	);
}

async function runInMemoryBenchmark() {
	const fixtureStartedAt = performance.now();
	const snapshot = finalizeTitleReviewSnapshot(fixtureRows(), 'benchmark');
	const buildMs = performance.now() - fixtureStartedAt;
	const scenarios = [
		['review-50', { tab: 'review_required', sort: 'confidence_desc', page: 1, limit: 50 }],
		['review-250', { tab: 'review_required', sort: 'confidence_desc', page: 1, limit: 250 }],
		['review-500', { tab: 'review_required', sort: 'confidence_desc', page: 1, limit: 500 }],
		['review-deep-page', { tab: 'review_required', sort: 'confidence_desc', page: 7, limit: 500 }],
		['review-search', { tab: 'review_required', sort: 'confidence_desc', page: 1, limit: 500, q: 'mulesoft' }],
		['unreviewed-500', { tab: 'unreviewed', sort: 'newest', page: 1, limit: 500 }],
		['failed-500', { tab: 'failed', sort: 'newest', page: 1, limit: 500 }],
	];
	const results = [];
	for (const [name, options] of scenarios) {
		results.push(await measure(name, 100, () => inMemoryList(snapshot, options)));
	}
	const concurrent = await measure('20-concurrent-clients', 20, async () => {
		await Promise.all(Array.from({ length: 20 }, () => Promise.resolve(inMemoryList(snapshot, scenarios[2][1]))));
	});
	results.push(concurrent);
	return {
		fixture: { rows: snapshot.entries.length, counts: snapshot.counts, buildMs: Number(buildMs.toFixed(2)) },
		results,
	};
}

async function requestLive(path, parameters) {
	const url = new URL(path, LIVE_BASE_URL.endsWith('/') ? LIVE_BASE_URL : `${LIVE_BASE_URL}/`);
	url.searchParams.set('applierName', APPLIER_NAME);
	for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 5_000);
	try {
		const response = await fetch(url, { signal: controller.signal });
		const body = await response.json();
		if (!response.ok) throw new Error(`${response.status} ${body.code || body.error}`);
		return { body, cache: response.headers.get('x-title-review-cache') };
	} finally {
		clearTimeout(timeout);
	}
}

async function runLiveBenchmark() {
	const common = { tab: 'review_required', sort: 'confidence_desc', page: 1, limit: 500 };
	const bootstrap = await measure('live-bootstrap-500', 1, () => requestLive('bootstrap', common));
	const warm = await measure('live-warm-500', 20, () => requestLive('', common));
	const search = await measure('live-warm-search', 20, () => requestLive('', { ...common, q: 'mulesoft' }));
	const concurrentStartedAt = performance.now();
	await Promise.all(Array.from({ length: 20 }, () => requestLive('', common)));
	const concurrent = summarize('live-20-concurrent-clients', [performance.now() - concurrentStartedAt]);
	if (bootstrap.maxMs > 2_500) throw new Error(`Bootstrap load target exceeded: ${bootstrap.maxMs}ms > 2500ms`);
	if (warm.p95Ms > 200) throw new Error(`Warm p95 target exceeded: ${warm.p95Ms}ms > 200ms`);
	if (search.p95Ms > 300) throw new Error(`Search p95 target exceeded: ${search.p95Ms}ms > 300ms`);
	return [bootstrap, warm, search, concurrent];
}

const report = { generatedAt: new Date().toISOString(), inMemory: await runInMemoryBenchmark() };
if (LIVE) report.live = await runLiveBenchmark();
console.log(JSON.stringify(report, null, 2));
