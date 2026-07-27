import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { exactRerankCandidates } from './exactRerank.js';

const configured = Number.parseInt(String(process.env.RANKING_WORKERS ?? ''), 10);
const webConcurrency = Number.parseInt(String(process.env.WEB_CONCURRENCY ?? ''), 10);
const multiProcessWeb = webConcurrency > 1 || (
  process.env.NODE_ENV === 'production' && String(process.env.WEB_CONCURRENCY ?? '') !== '1'
);
const poolSize = Number.isFinite(configured)
  ? Math.max(0, configured)
  : multiProcessWeb
    ? 1
    : Math.max(1, Math.min(4, (os.availableParallelism?.() || os.cpus().length) - 1));
const workers = [];
const idle = [];
const queue = [];
let nextId = 1;
let shuttingDown = false;

function removeFrom(list, value) {
  let index = list.indexOf(value);
  while (index >= 0) {
    list.splice(index, 1);
    index = list.indexOf(value);
  }
}

function retireWorker(worker, error) {
  removeFrom(idle, worker);
  removeFrom(workers, worker);
  const task = worker.current;
  worker.current = null;
  if (task) task.reject(error);
  if (!shuttingDown && queue.length) {
    ensurePool();
    dispatch();
  }
}

function dispatch() {
  while (idle.length && queue.length) {
    const worker = idle.pop();
    const task = queue.shift();
    worker.current = task;
    try {
      worker.postMessage({ id: task.id, ...task.payload });
    } catch (error) {
      retireWorker(worker, error);
    }
  }
}

function createPoolWorker() {
  const worker = new Worker(new URL('./exactRerankWorker.js', import.meta.url), { type: 'module' });
  worker.current = null;
  worker.on('message', (message) => {
    const task = worker.current;
    worker.current = null;
    if (task) {
      if (message.error) task.reject(new Error(message.error));
      else task.resolve(message.result);
    }
    if (workers.includes(worker) && !shuttingDown) {
      idle.push(worker);
      dispatch();
    }
  });
  worker.on('error', (error) => {
    retireWorker(worker, error);
  });
  worker.on('exit', (code) => {
    if (workers.includes(worker)) {
      retireWorker(worker, new Error(`ranking worker exited with code ${code}`));
    }
  });
  workers.push(worker);
  idle.push(worker);
}

function ensurePool() {
  while (workers.length < poolSize) createPoolWorker();
}

function enqueueWorkerTask(payload) {
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, payload, resolve, reject });
    dispatch();
  });
}

export async function warmRankingPool() {
  if (poolSize === 0) return;
  ensurePool();
  await Promise.all(Array.from({ length: poolSize }, () => enqueueWorkerTask({
    candidates: [],
    profileCtx: {},
    scoreFilters: {},
    limit: 0,
  })));
}

export async function rerankInPool(candidates, profileCtx, scoreFilters, limit) {
  if (poolSize === 0 || candidates.length < 250) {
    return exactRerankCandidates(candidates, profileCtx, scoreFilters, limit);
  }
  ensurePool();
  try {
    return await enqueueWorkerTask({ candidates, profileCtx, scoreFilters, limit });
  } catch (error) {
    console.warn('[ranking] worker rerank failed; using main thread:', error?.message || error);
    return exactRerankCandidates(candidates, profileCtx, scoreFilters, limit);
  }
}

export async function shutdownRankingPool() {
  shuttingDown = true;
  await Promise.all(workers.map((worker) => worker.terminate()));
  workers.length = 0;
  idle.length = 0;
  queue.splice(0).forEach((task) => task.reject(new Error('ranking pool shutting down')));
}
