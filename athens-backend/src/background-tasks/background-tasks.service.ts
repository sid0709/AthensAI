import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccountInfoService } from '../auth/account-info.service';
import { MailCredentialsService } from '../mail/mail-credentials.service';
import {
  BACKGROUND_TASK_STATUSES,
  BACKGROUND_TASK_TYPES,
} from './constants/task-types';
import { normalizeTaskPayload } from './task-payload';
import { TaskStoreService } from './task-store.service';

@Injectable()
export class BackgroundTasksService {
  private workerHealthy = false;

  constructor(
    private readonly store: TaskStoreService,
    private readonly accounts: AccountInfoService,
    private readonly mailCreds: MailCredentialsService,
  ) {}

  setWorkerHealthy(ok: boolean) {
    this.workerHealthy = ok;
  }

  isWorkerHealthy() {
    return this.workerHealthy;
  }

  async create(input: {
    requestId?: string;
    type: string;
    profileId?: string;
    applierName?: string;
    payload?: Record<string, unknown>;
  }) {
    if (input.type !== BACKGROUND_TASK_TYPES.MAIL_AI_LABEL) {
      throw new BadRequestException(
        `Unsupported background task type: ${input.type}`,
      );
    }
    if (!this.workerHealthy) {
      throw new ServiceUnavailableException({
        success: false,
        error: 'BACKGROUND_WORKER_UNAVAILABLE',
        message: 'Background worker is not available',
      });
    }

    const applierName = String(input.applierName || '').trim();
    if (!applierName) {
      throw new BadRequestException('applierName is required');
    }

    const account = await this.accounts.findByName(applierName);
    if (!account) throw new NotFoundException('Account not found');
    if (!this.mailCreds.isBeta(account.tier)) {
      throw new BadRequestException('Beta access required for mail_ai_label');
    }

    if (input.requestId) {
      const existing = await this.store.findByRequestId(input.requestId);
      if (existing) {
        return {
          success: true,
          created: false,
          duplicate: true,
          task: this.store.toPublic(existing),
        };
      }
      const reserved = await this.store.reserve(
        `request:${input.requestId}`,
        'pending',
      );
      if (!reserved) {
        const again = await this.store.findByRequestId(input.requestId);
        if (again) {
          return {
            success: true,
            created: false,
            duplicate: true,
            task: this.store.toPublic(again),
          };
        }
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = normalizeTaskPayload(input.type, input.payload);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : String(err),
      );
    }

    const task = await this.store.create({
      requestId: input.requestId,
      type: input.type,
      profileId: input.profileId || account.id,
      applierName: account.name,
      payload,
    });

    if (input.requestId) {
      await this.store.reserve(`request:${input.requestId}`, task.id);
    }

    return {
      success: true,
      created: true,
      task: this.store.toPublic(task),
    };
  }

  async list(opts: {
    profileId?: string;
    active?: boolean;
    limit?: number;
  }) {
    const tasks = await this.store.list(opts);
    return {
      success: true,
      tasks: tasks.map((t) => this.store.toPublic(t)),
    };
  }

  async get(taskId: string) {
    const task = await this.store.findById(taskId);
    if (!task) throw new NotFoundException('Task not found');
    return { success: true, task: this.store.toPublic(task) };
  }

  async cancel(taskId: string) {
    const task = await this.store.requestCancel(taskId);
    if (!task) throw new NotFoundException('Task not found');
    return { success: true, task: this.store.toPublic(task) };
  }

  getStore() {
    return this.store;
  }
}
