import { computeCoverageScore } from './coverageScore.js';

function inside(value, bounds) {
  if (!bounds) return true;
  if (bounds.min != null && value < bounds.min) return false;
  if (bounds.max != null && value > bounds.max) return false;
  return true;
}

export function exactRerankCandidates(candidates, profileCtx, scoreFilters = {}, limit = 2000) {
  const proficiencyCache = new Map();
  return candidates
    .map((candidate) => {
      const coverage = computeCoverageScore(
        candidate.payload?.rankSkills || candidate.payload?.aiSkills || [],
        profileCtx,
        proficiencyCache,
      );
      return {
        jobId: String(candidate.jobId),
        sparseScore: Number(candidate.sparseScore) || 0,
        semanticRank: candidate.semanticRank ?? null,
        fusionScore: Number(candidate.fusionScore) || 0,
        exactScore: coverage.matchScore,
        postedAt: candidate.payload?.postedAt || null,
        catalog: candidate.payload?.catalog || 'market',
      };
    })
    .filter((entry) =>
      inside(entry.exactScore, scoreFilters?.overallScore) &&
      inside(entry.exactScore, scoreFilters?.skillMatch),
    )
    .sort((left, right) =>
      right.exactScore - left.exactScore ||
      String(right.postedAt || '').localeCompare(String(left.postedAt || '')) ||
      String(right.jobId).localeCompare(String(left.jobId)),
    )
    .slice(0, limit);
}
