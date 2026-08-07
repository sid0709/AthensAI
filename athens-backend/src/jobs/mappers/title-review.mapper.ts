import type { Job } from '@prisma/client';

type TitleReviewCapsule = {
  processingState?: string;
  label?: string;
  aiLabel?: string;
  originalTitle?: string;
  confidence?: number;
  reason?: string;
  decisionSource?: string;
  classifiedAt?: string;
  error?: { code?: string; message?: string; failedAt?: string };
};

function asCapsule(raw: unknown): TitleReviewCapsule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const meta = raw as { titleReview?: unknown };
  if (!meta.titleReview || typeof meta.titleReview !== 'object') return null;
  return meta.titleReview;
}

/** Map Job + queue state → Athens TitleReviewJob row. */
export function mapJobToTitleReviewRow(
  job: Pick<
    Job,
    | 'id'
    | 'title'
    | 'companyName'
    | 'source'
    | 'postedAt'
    | 'applyLink'
    | 'titleReviewLabel'
    | 'metadata'
  >,
  queueState: string,
) {
  const capsule = asCapsule(job.metadata);
  const processingState =
    queueState === 'failed'
      ? 'failed'
      : queueState === 'review_required'
        ? 'completed'
        : capsule?.processingState === 'scanning'
          ? 'scanning'
          : 'pending';

  const label =
    job.titleReviewLabel === 'APPROVED' ||
    job.titleReviewLabel === 'REVIEW_REQUIRED'
      ? job.titleReviewLabel
      : capsule?.label === 'APPROVED' || capsule?.label === 'REVIEW_REQUIRED'
        ? capsule.label
        : undefined;

  return {
    id: job.id,
    title: job.title,
    company: job.companyName,
    source: job.source,
    postedAt: job.postedAt.toISOString(),
    applyUrl: job.applyLink ?? undefined,
    titleReview: {
      processingState,
      ...(label ? { label } : {}),
      ...(capsule?.aiLabel ? { aiLabel: capsule.aiLabel } : {}),
      ...(capsule?.originalTitle
        ? { originalTitle: capsule.originalTitle }
        : {}),
      ...(typeof capsule?.confidence === 'number'
        ? { confidence: capsule.confidence }
        : {}),
      ...(capsule?.reason ? { reason: capsule.reason } : {}),
      ...(capsule?.decisionSource
        ? { decisionSource: capsule.decisionSource }
        : {}),
      ...(capsule?.classifiedAt ? { classifiedAt: capsule.classifiedAt } : {}),
      ...(capsule?.error ? { error: capsule.error } : {}),
    },
  };
}
