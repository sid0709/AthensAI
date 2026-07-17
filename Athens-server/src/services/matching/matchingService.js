import { ObjectId } from 'mongodb';
import { jobsCollection } from '../../db/mongo.js';
import { isRedisReady } from '../../db/redis.js';
import { JOB_LIST_PROJECTION } from '../jobListQuery.js';
import { loadProfileMatchContext, invalidateProfileSkillCache } from './profileSkills.js';
import {
  findCandidateJobIds,
  normalizeJobSkills,
} from './skillIndex.js';
import { enrichJobSkillsFromTitle } from './jobSkillExtraction.js';
import {
  computeCoverageScore,
  composeJobScores,
  applyScoreFilters,
} from './coverageScore.js';
import { normalizeSkillSet } from '@nextoffer/shared/skill-normalize';

const MAX_CANDIDATES = 50000;

/**
 * Score and rank jobs for an applier by skill coverage (no embeddings). This is
 * the legacy/warming fallback; the primary path is the materialized
 * job_match_scores collection.
 */
export async function matchJobsForApplier({
  applierName,
  mongoQuery,
  scoreFilters,
  skip = 0,
  limit = 25,
}) {
  const name = String(applierName || '').trim();
  if (!name) {
    return { docs: [], total: 0, recommendationFallback: true, reason: 'no_applier' };
  }

  const profileCtx = await loadProfileMatchContext(name);
  if (!profileCtx.profileTokens?.length && !profileCtx.profileCompacts?.length && !profileCtx.exactSet?.size) {
    return { docs: [], total: 0, recommendationFallback: true, reason: 'no_profile_skills' };
  }

  if (!jobsCollection) {
    return { docs: [], total: 0, recommendationFallback: true, reason: 'db_not_ready' };
  }

  const catalogTotal = await jobsCollection.countDocuments(mongoQuery || {});
  const hasScoreFilter = !!(scoreFilters && Object.keys(scoreFilters).length);

  let scoredRows = [];
  const candidateIds = new Set();

  if (isRedisReady()) {
    const redisIds = await findCandidateJobIds(profileCtx.profileTokens);
    if (redisIds?.size) {
      for (const id of redisIds) candidateIds.add(String(id));
    }
  }

  if (candidateIds.size) {
    const idList = [...candidateIds].slice(0, MAX_CANDIDATES);
    const objectIds = idList.map((id) => {
      try { return new ObjectId(id); } catch { return null; }
    }).filter(Boolean);

    const jobs = await jobsCollection
      .find({ $and: [mongoQuery || {}, { _id: { $in: objectIds } }] })
      .project(JOB_LIST_PROJECTION)
      .toArray();

    for (const job of jobs) {
      const enriched = enrichJobSkillsFromTitle(job);
      const jobSkills = Array.isArray(job.aiSkills) && job.aiSkills.length ? job.aiSkills : enriched.skills;
      const coverage = computeCoverageScore(jobSkills, profileCtx);
      if (coverage.required === 0) continue;

      scoredRows.push({
        job,
        enriched,
        coverage: { ...coverage, finalScore: coverage.matchScore },
        matchScore: coverage.matchScore,
        vectorScore: null,
      });
    }
  } else if (!isRedisReady()) {
    scoredRows = await scoreViaMongoScan({
      mongoQuery: mongoQuery || {},
      profileCtx,
      maxScan: MAX_CANDIDATES,
    });
  }

  scoredRows.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    const aDate = new Date(a.job.postedAt || a.job._createdAt || 0).getTime();
    const bDate = new Date(b.job.postedAt || b.job._createdAt || 0).getTime();
    return bDate - aDate;
  });

  const composeRow = (row) => {
    const enriched = row.enriched || enrichJobSkillsFromTitle(row.job);
    return {
      ...row.job,
      skills: enriched.skills,
      skillsNormalized: enriched.skillsNormalized,
      ...composeJobScores(
        { ...row.job, skills: enriched.skills },
        row.coverage,
        { vectorScore: row.vectorScore },
      ),
    };
  };

  let pageDocs;
  let rankedIds;

  if (hasScoreFilter) {
    const docs = scoredRows.map(composeRow);
    const filtered = applyScoreFilters(docs, scoreFilters);
    rankedIds = filtered.map((d) => d._id);
    pageDocs = filtered.slice(skip, skip + limit);
  } else {
    rankedIds = scoredRows.map((row) => row.job._id);
    pageDocs = scoredRows.slice(skip, skip + limit).map(composeRow);
  }

  if (!hasScoreFilter && pageDocs.length < limit && catalogTotal > skip + pageDocs.length) {
    const needed = limit - pageDocs.length;
    const dateSkip = Math.max(0, skip - scoredRows.length);
    const dateDocs = await jobsCollection
      .find(
        { $and: [mongoQuery || {}, { _id: { $nin: rankedIds } }] },
        { projection: JOB_LIST_PROJECTION },
      )
      .sort({ postedAt: -1, _id: -1 })
      .skip(dateSkip)
      .limit(needed)
      .toArray();
    pageDocs = [
      ...pageDocs,
      ...dateDocs.map((j) => ({
        ...j,
        ...composeJobScores(j, { matchScore: 0, covered: [], missing: [], required: 0 }),
        recommendationRanked: false,
      })),
    ];
  }

  return {
    docs: pageDocs,
    total: catalogTotal,
    catalogTotal,
    recommendationFallback: false,
    recommendationHybrid: false,
  };
}

async function scoreViaMongoScan({ mongoQuery, profileCtx, maxScan }) {
  const rows = [];
  const profileSkills = profileCtx.exactSet;
  const cursor = jobsCollection
    .find({
      $and: [
        mongoQuery,
        {
          $or: [
            { skillsNormalized: { $in: [...profileSkills] } },
            { skills: { $exists: true, $ne: [] } },
          ],
        },
      ],
    })
    .project(JOB_LIST_PROJECTION)
    .sort({ postedAt: -1 })
    .limit(maxScan);

  for await (const job of cursor) {
    const enriched = enrichJobSkillsFromTitle(job);
    const jobSkills = Array.isArray(job.aiSkills) && job.aiSkills.length ? job.aiSkills : enriched.skills;
    const coverage = computeCoverageScore(jobSkills, profileCtx);
    if (coverage.required === 0 || coverage.matchScore === 0) continue;

    rows.push({
      job,
      enriched,
      coverage: { ...coverage, finalScore: coverage.matchScore },
      matchScore: coverage.matchScore,
      vectorScore: null,
    });
  }
  return rows;
}

/** Score a single job against a profile (radar / detail views). */
export async function scoreJobAgainstProfile(job, profileSkills) {
  const { skills } = enrichJobSkillsFromTitle(job);
  return computeCoverageScore(skills, profileSkills);
}

export function invalidateRecommendationCache(applierName) {
  return invalidateProfileSkillCache(applierName);
}

export { normalizeSkillSet, normalizeJobSkills };
