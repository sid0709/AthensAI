import type { ChatRequest } from './types.js';
import { incrementMetric, observeMetric, setMetricGauge } from './metrics.js';

export type AdmissionLane = 'interactive' | 'resume' | 'title' | 'skill' | 'mail' | 'other';

type Waiter = {
  lane: AdmissionLane;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  queuedAt: number;
};

const BACKGROUND_LANES: AdmissionLane[] = ['resume', 'title', 'skill', 'mail', 'other'];
const ALL_LANES: AdmissionLane[] = ['interactive', ...BACKGROUND_LANES];

function positiveEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function abortError(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  return Object.assign(new Error('AI request cancelled while waiting for admission'), { name: 'AbortError' });
}

export function admissionLane(request: ChatRequest): AdmissionLane {
  if (request.workloadClass !== 'background') return 'interactive';
  const feature = String(request.feature || '').toLowerCase();
  if (feature.includes('resume')) return 'resume';
  if (feature.includes('title-review')) return 'title';
  if (/skill|extract|enrich|embedding/.test(feature)) return 'skill';
  if (/mail|label/.test(feature)) return 'mail';
  return 'other';
}

/**
 * One gateway-wide, work-conserving admission pool. Background lanes are served
 * round-robin so simultaneous résumé/title/skill work cannot starve another
 * lane. Interactive calls use the same global ceiling and their own sub-limit.
 */
export class GatewayAdmissionPool {
  private readonly globalMax: number;
  private readonly interactiveMax: number;
  private globalActive = 0;
  private interactiveActive = 0;
  private cursor = 0;
  private readonly queues = new Map<AdmissionLane, Waiter[]>(
    ALL_LANES.map((lane) => [lane, []]),
  );

  constructor({
    globalConcurrency = positiveEnv('AI_GATEWAY_GLOBAL_CONCURRENCY', 48),
    interactiveConcurrency = positiveEnv('AI_GATEWAY_INTERACTIVE_CONCURRENCY', 8),
  }: { globalConcurrency?: number; interactiveConcurrency?: number } = {}) {
    this.globalMax = Math.max(1, globalConcurrency);
    this.interactiveMax = Math.max(1, Math.min(this.globalMax, interactiveConcurrency));
  }

  acquire(lane: AdmissionLane, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { lane, resolve, reject, signal, queuedAt: performance.now() };
      waiter.onAbort = () => {
        const queue = this.queues.get(lane)!;
        const index = queue.indexOf(waiter);
        if (index >= 0) queue.splice(index, 1);
        incrementMetric('ai_gateway_admission_cancelled_total', { lane });
        this.publishMetrics();
        reject(abortError(signal));
      };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      this.queues.get(lane)!.push(waiter);
      this.publishMetrics();
      this.drain();
    });
  }

  async run<T>(lane: AdmissionLane, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(lane, signal);
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private canGrant(lane: AdmissionLane): boolean {
    return this.globalActive < this.globalMax
      && (lane !== 'interactive' || this.interactiveActive < this.interactiveMax);
  }

  private nextLane(): AdmissionLane | null {
    for (let offset = 0; offset < ALL_LANES.length; offset += 1) {
      const index = (this.cursor + offset) % ALL_LANES.length;
      const lane = ALL_LANES[index];
      if (this.queues.get(lane)!.length && this.canGrant(lane)) {
        this.cursor = (index + 1) % ALL_LANES.length;
        return lane;
      }
    }
    return null;
  }

  private drain(): void {
    while (this.globalActive < this.globalMax) {
      const lane = this.nextLane();
      if (!lane) return;
      const waiter = this.queues.get(lane)!.shift()!;
      if (waiter.signal?.aborted) {
        waiter.signal.removeEventListener('abort', waiter.onAbort!);
        waiter.reject(abortError(waiter.signal));
        continue;
      }
      waiter.signal?.removeEventListener('abort', waiter.onAbort!);
      this.globalActive += 1;
      if (lane === 'interactive') this.interactiveActive += 1;
      observeMetric('ai_gateway_admission_wait_seconds', { lane }, Math.max(0, performance.now() - waiter.queuedAt) / 1_000);
      this.publishMetrics();
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.globalActive = Math.max(0, this.globalActive - 1);
        if (lane === 'interactive') this.interactiveActive = Math.max(0, this.interactiveActive - 1);
        this.publishMetrics();
        this.drain();
      });
    }
  }

  snapshot() {
    return {
      active: this.globalActive,
      max: this.globalMax,
      interactiveActive: this.interactiveActive,
      interactiveMax: this.interactiveMax,
      pending: Object.fromEntries(ALL_LANES.map((lane) => [lane, this.queues.get(lane)!.length])),
    };
  }

  private publishMetrics(): void {
    setMetricGauge('ai_gateway_admission_active', { lane: 'all' }, this.globalActive);
    setMetricGauge('ai_gateway_admission_active', { lane: 'interactive' }, this.interactiveActive);
    for (const lane of ALL_LANES) {
      setMetricGauge('ai_gateway_admission_pending', { lane }, this.queues.get(lane)!.length);
    }
  }
}
