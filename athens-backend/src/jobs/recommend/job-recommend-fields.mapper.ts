/** Shape merged onto Job Search list/detail docs from vendor_tasks. */
export type JobRecommendFields = {
  recommendedResumeStack: string | null;
  recommendedResumeId: string | null;
  recommendedResumeReason: string | null;
  useCustomizedResume: boolean;
  recommendWarning: string | null;
  recommendedAt: string | null;
  recommendMode: string | null;
};

export function hasStoredRecommendation(row: {
  recommendedResumeStack?: string | null;
  recommendedResumeId?: string | null;
  useCustomizedResume?: boolean | null;
  recommendedAt?: Date | string | null;
  recommendedResumeReason?: string | null;
  recommendWarning?: string | null;
}): boolean {
  if (row.recommendedAt) return true;
  if (String(row.recommendedResumeStack || '').trim()) return true;
  if (String(row.recommendedResumeId || '').trim()) return true;
  if (row.useCustomizedResume) return true;
  if (String(row.recommendedResumeReason || '').trim()) return true;
  if (String(row.recommendWarning || '').trim()) return true;
  return false;
}

export function mapVendorTaskRecommendFields(row: {
  recommendedResumeStack?: string | null;
  recommendedResumeId?: string | null;
  recommendedResumeReason?: string | null;
  useCustomizedResume?: boolean | null;
  recommendWarning?: string | null;
  recommendedAt?: Date | string | null;
  recommendMode?: string | null;
}): JobRecommendFields {
  const recommendedAt =
    row.recommendedAt instanceof Date
      ? row.recommendedAt.toISOString()
      : typeof row.recommendedAt === 'string' && row.recommendedAt.trim()
        ? row.recommendedAt.trim()
        : null;

  return {
    recommendedResumeStack:
      String(row.recommendedResumeStack || '').trim() || null,
    recommendedResumeId: String(row.recommendedResumeId || '').trim() || null,
    recommendedResumeReason:
      String(row.recommendedResumeReason || '').trim() || null,
    useCustomizedResume: Boolean(row.useCustomizedResume),
    recommendWarning: String(row.recommendWarning || '').trim() || null,
    recommendedAt,
    recommendMode:
      row.recommendMode === 'llm' ||
      row.recommendMode === 'heuristic' ||
      row.recommendMode === 'manual'
        ? row.recommendMode
        : null,
  };
}
