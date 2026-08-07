import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MailAiLabelService } from '../../mail/mail-ai-label.service';
import { MailCredentialsService } from '../../mail/mail-credentials.service';
import { BackgroundTasksService } from '../background-tasks.service';
import {
  BACKGROUND_TASK_STATUSES,
  BACKGROUND_TASK_TYPES,
  WORKER_HEARTBEAT_MS,
} from '../constants/task-types';
import type { MailAiLabelProgress } from '../../mail/mail-ai-label.service';

@Injectable()
export class BackgroundTaskWorker implements OnModuleInit {
  private readonly logger = new Logger(BackgroundTaskWorker.name);
  private readonly workerId = `embedded-${randomUUID().slice(0, 8)}`;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly tasks: BackgroundTasksService,
    private readonly mailCreds: MailCredentialsService,
    private readonly aiLabel: MailAiLabelService,
  ) {}

  onModuleInit() {
    const mode = String(process.env.BACKGROUND_WORKERS_MODE || 'embedded')
      .trim()
      .toLowerCase();
    if (mode === 'off' || mode === 'disabled') {
      this.tasks.setWorkerHealthy(false);
      this.logger.warn('Background worker disabled via BACKGROUND_WORKERS_MODE');
      return;
    }
    this.tasks.setWorkerHealthy(true);
    this.timer = setInterval(() => {
      void this.tick();
    }, WORKER_HEARTBEAT_MS);
    this.timer.unref?.();
    void this.tick();
    this.logger.log(`Embedded background worker started (${this.workerId})`);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const store = this.tasks.getStore();
      const task = await store.claimNext(
        this.workerId,
        BACKGROUND_TASK_TYPES.MAIL_AI_LABEL,
      );
      if (!task) return;
      await this.processMailAiLabel(task.id);
    } catch (err) {
      this.logger.error(
        `Worker tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async processMailAiLabel(taskId: string) {
    const store = this.tasks.getStore();
    const task = await store.findById(taskId);
    if (!task) return;

    const abort = new AbortController();
    const heartbeat = setInterval(() => {
      void store.heartbeat(taskId, this.workerId);
      void store.findById(taskId).then((fresh) => {
        if (fresh?.status === BACKGROUND_TASK_STATUSES.CANCELLING) {
          abort.abort();
        }
      });
    }, WORKER_HEARTBEAT_MS);

    try {
      const applierName = String(task.applierName || '');
      const creds = await this.mailCreds.resolve(applierName);
      if (!creds.ok) {
        await store.complete(
          taskId,
          {},
          BACKGROUND_TASK_STATUSES.FAILED,
          creds.error,
        );
        return;
      }

      const payload =
        task.payload && typeof task.payload === 'object'
          ? (task.payload as { messageIds?: string[] })
          : {};
      const messageIds = Array.isArray(payload.messageIds)
        ? payload.messageIds.map(String)
        : [];

      const batch = await this.aiLabel.runBatch({
        creds,
        messageIds,
        signal: abort.signal,
        onProgress: async (progress: MailAiLabelProgress) => {
          await store.updateProgress(taskId, progress as unknown as Record<string, unknown>, {
            status:
              abort.signal.aborted
                ? BACKGROUND_TASK_STATUSES.CANCELLING
                : BACKGROUND_TASK_STATUSES.RUNNING,
          });
        },
      });

      const failed = batch.results.filter((r: { error?: string }) => r.error).length;
      const status = abort.signal.aborted
        ? BACKGROUND_TASK_STATUSES.CANCELLED
        : failed > 0
          ? BACKGROUND_TASK_STATUSES.COMPLETED_WITH_ERRORS
          : BACKGROUND_TASK_STATUSES.COMPLETED;

      await store.complete(taskId, batch as unknown as Record<string, unknown>, status);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await store.complete(
        taskId,
        {},
        abort.signal.aborted
          ? BACKGROUND_TASK_STATUSES.CANCELLED
          : BACKGROUND_TASK_STATUSES.FAILED,
        message,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }
}
