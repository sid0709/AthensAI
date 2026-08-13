import { Injectable } from '@nestjs/common';
import { JobStatusMutateService } from '../../jobs/job-status-mutate.service';
import { JobWorkerPoolService } from '../../jobs/job-worker-pool.service';

@Injectable()
export class OakJobsMarkAppliedService {
  constructor(
    private readonly workerPool: JobWorkerPoolService,
    private readonly mutate: JobStatusMutateService,
  ) {}

  /**
   * Same Job Search sequence: leave Worker pool, then mark applied.
   * Re-queues Worker pool if apply fails after a successful clear.
   */
  async markApplied(applierName: string, jobId: string) {
    const cleared = await this.workerPool.setStatus(
      jobId,
      applierName,
      'clear',
    );
    try {
      return await this.mutate.apply(jobId, applierName);
    } catch (err) {
      if (cleared.changed) {
        await this.workerPool.setStatus(jobId, applierName, 'WorkerPool');
      }
      throw err;
    }
  }
}
