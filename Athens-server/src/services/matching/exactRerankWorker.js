import { parentPort } from 'node:worker_threads';
import { exactRerankCandidates } from './exactRerank.js';

parentPort.on('message', ({ id, candidates, profileCtx, scoreFilters, limit }) => {
  try {
    const result = exactRerankCandidates(candidates, profileCtx, scoreFilters, limit);
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message || error) });
  }
});
