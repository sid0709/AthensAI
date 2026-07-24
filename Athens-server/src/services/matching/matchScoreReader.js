import { jobsCollection, jobMatchScoresCollection, externalScrapedJobsCollection } from '../../db/mongo.js';
import { JobSourceTitles } from '../../config/jobSources.js';
import { isMaterializedRecommendationEnabled } from '../../config/graphAndVectorConfig.js';
import { JOB_LIST_PROJECTION } from '../jobListQuery.js';
import { normalizeExternalScrapedJob } from '../externalScrapedJobsListQuery.js';
import { loadProfileMatchContext } from './profileSkills.js';
import { matchJobsForApplier } from './matchingService.js';
import { enrichJobSkillsFromTitle } from './jobSkillExtraction.js';
import { computeCoverageScore, composeJobScores } from './coverageScore.js';
import { countScoresForApplier, getRescoreState } from './matchScoreStore.js';

function isFirestoreRuntime() {
  return String(process.env.DATABASE_BACKEND || '').trim().toLowerCase() === 'firestore';
}

const firestoreRecommendationMeta = new Map();

function refreshFirestoreRecommendationMeta(name) {
  const existing = firestoreRecommendationMeta.get(name);
  if (existing?.promise) return existing.promise;
  const promise = Promise.all([
    loadProfileMatchContext(name),
    countScoresForApplier(name),
    getRescoreState(name),
  ]).then(([profileCtx, rowCount, state]) => {
    const value = {
      profileCtx,
      rowCount,
      state,
      expiresAt: Date.now() + 30_000,
    };
    firestoreRecommendationMeta.set(name, value);
    return value;
  }).catch((error) => {
    firestoreRecommendationMeta.delete(name);
    console.warn('[match-score] recommendation metadata warmup failed:', error?.message || error);
    return null;
  });
  firestoreRecommendationMeta.set(name, { promise, expiresAt: 0 });
  return promise;
}

async function listFirestoreWarmingPage({ mongoQuery, skip, limit }) {
  const [docs, total] = await Promise.all([
    jobsCollection
      .find(mongoQuery || {}, { projection: JOB_LIST_PROJECTION })
      .sort({ postedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    jobsCollection.countDocuments(mongoQuery || {}),
  ]);

  return {
    docs: docs.map((job) => ({
      ...job,
      ...composeJobScores(job, { matchScore: 0, covered: [], missing: [], required: 0 }),
      recommendationRanked: false,
    })),
    total,
    catalogTotal: total,
    recommendationFallback: false,
    recommendationHybrid: false,
    recommendationMaterialized: true,
    recommendationWarming: true,
  };
}

async function listFromMaterializedScoresFirestore({
  applierName,
  mongoQuery,
  scoreFilters,
  listBody,
  skip,
  limit,
}) {
  const profileCtx = await loadProfileMatchContext(applierName);
  const prefilters = buildScoreRowPrefilters(listBody);
  const scoreRange = buildScoreRangeClause(scoreFilters);
  const scoreMatch = { applierName, ...prefilters };
  if (scoreRange) scoreMatch.score = scoreRange;

  const overscan = Math.min(500, Math.max(limit, limit * 4));
  const [scoreRows, catalogTotal] = await Promise.all([
    jobMatchScoresCollection
      .find(scoreMatch)
      .sort({ score: -1, postedAt: -1, jobId: -1 })
      .skip(skip)
      .limit(overscan)
      .toArray(),
    jobsCollection.countDocuments(mongoQuery || {}),
  ]);

  const jobIds = scoreRows.map((row) => row.jobId).filter(Boolean);
  const jobs = jobIds.length
    ? await jobsCollection
        .find({ $and: [mongoQuery || {}, { _id: { $in: jobIds } }] }, { projection: JOB_LIST_PROJECTION })
        .toArray()
    : [];
  const jobsById = new Map(jobs.map((job) => [String(job._id), job]));
  let pageDocs = scoreRows
    .map((row) => jobsById.get(String(row.jobId)))
    .filter(Boolean)
    .slice(0, limit)
    .map((job) => composePageDoc(job, profileCtx));

  if (!scoreRange && pageDocs.length < limit) {
    const fill = await listFirestoreWarmingPage({ mongoQuery, skip: 0, limit: limit * 2 });
    const used = new Set(pageDocs.map((job) => String(job._id)));
    pageDocs = [
      ...pageDocs,
      ...fill.docs.filter((job) => !used.has(String(job._id))).slice(0, limit - pageDocs.length),
    ];
  }

  return {
    docs: pageDocs,
    total: catalogTotal,
    catalogTotal,
    recommendationFallback: false,
    recommendationHybrid: false,
    recommendationMaterialized: true,
  };
}

/**
 * Read path for Best Match over the materialized job_match_scores collection:
 * an index scan on { applierName, score, postedAt } plus ~limit point lookups
 * into job_market, instead of scoring the whole catalog per request.
 *
 * Display fields (skillsMissing, exact covered/required) are recomputed for
 * the visible page only from the cached profile context — this also
 * self-corrects minor staleness while a background rescore is running.
 */

/**
 * Clauses from the list body that are denormalized onto score rows (source,
 * postedAt) — applied BEFORE the $lookup so the index scan prunes early.
 * Mirrors buildJobsListQuery's handling of the same body fields.
 */
function buildScoreRowPrefilters(listBody = {}) {
  const prefilters = {};

  const { jobSources, postedAtFrom, postedAtTo } = listBody;
  const jobSourceItem = (jobSources !== undefined ? jobSources.split(',') : JobSourceTitles)
    .map((s) => s.trim())
    .filter(Boolean);
  const knownSources = JobSourceTitles.filter((s) => s !== 'Other');
  const allSourcesSelected =
    jobSourceItem.includes('Other') && knownSources.every((s) => jobSourceItem.includes(s));
  if (!allSourcesSelected) {
    prefilters.source = { $in: jobSourceItem };
  }

  if (postedAtFrom || postedAtTo) {
    const postedAtQuery = {};
    if (postedAtFrom) postedAtQuery.$gte = postedAtFrom;
    if (postedAtTo) {
      const toDate = new Date(postedAtTo);
      toDate.setDate(toDate.getDate() + 1);
      postedAtQuery.$lt = toDate.toISOString().split('T')[0];
    }
    prefilters.postedAt = postedAtQuery;
  }

  return prefilters;
}

/**
 * Fold scoreOverall + scoreSkill bounds into one indexed range on `score`
 * (valid because scoreOverall === scoreSkill with hybrid ranking off).
 */
export function buildScoreRangeClause(scoreFilters) {
  if (!scoreFilters || !Object.keys(scoreFilters).length) return null;
  let gte = null;
  let lte = null;
  for (const bounds of Object.values(scoreFilters)) {
    if (bounds.min !== null && bounds.min !== undefined) {
      gte = gte === null ? bounds.min : Math.max(gte, bounds.min);
    }
    if (bounds.max !== null && bounds.max !== undefined) {
      lte = lte === null ? bounds.max : Math.min(lte, bounds.max);
    }
  }
  if (gte === null && lte === null) return null;
  const range = {};
  if (gte !== null) range.$gte = gte;
  if (lte !== null) range.$lte = lte;
  return range;
}

/** Body fields whose filters only exist on job docs, not on score rows. */
function hasVolatileFilters(listBody = {}) {
  if (listBody.q || listBody.applied !== undefined || listBody.status) return true;
  return Object.keys(listBody).some(
    (k) => k.startsWith('company.') || k.startsWith('details.'),
  );
}

export function composePageDoc(job, profileCtx) {
  // Prefer AI skills (requirement-weighted) for the displayed score; fall back
  // to title-derived strings for a not-yet-extracted job.
  const hasAi = Array.isArray(job.aiSkills) && job.aiSkills.length;
  const enriched = enrichJobSkillsFromTitle(job);
  const jobSkills = hasAi ? job.aiSkills : enriched.skills;
  const coverage = computeCoverageScore(jobSkills, profileCtx);
  const displaySkills = hasAi ? job.aiSkills.map((s) => s.name) : enriched.skills;
  return {
    ...job,
    skills: displaySkills,
    skillsNormalized: enriched.skillsNormalized,
    ...composeJobScores({ ...job, skills: displaySkills }, coverage, { vectorScore: null }),
  };
}

async function listFromMaterializedScores({
  applierName,
  mongoQuery,
  scoreFilters,
  listBody,
  skip,
  limit,
}) {
  const profileCtx = await loadProfileMatchContext(applierName);
  const prefilters = buildScoreRowPrefilters(listBody);
  const scoreRange = buildScoreRangeClause(scoreFilters);
  const hasScoreFilter = scoreRange !== null;

  const scoreMatch = { applierName, ...prefilters };
  if (scoreRange) scoreMatch.score = scoreRange;

  const catalogTotal = await jobsCollection.countDocuments(mongoQuery || {});

  const pageRows = await jobMatchScoresCollection
    .aggregate([
      { $match: scoreMatch },
      { $sort: { score: -1, postedAt: -1, jobId: -1 } },
      {
        $lookup: {
          from: 'job_market',
          localField: 'jobId',
          foreignField: '_id',
          pipeline: [{ $match: mongoQuery || {} }, { $project: JOB_LIST_PROJECTION }],
          as: 'job',
        },
      },
      { $unwind: '$job' },
      { $skip: skip },
      { $limit: limit },
    ])
    .toArray();

  let pageDocs = pageRows.map((row) => composePageDoc(row.job, profileCtx));

  // Tail fill: after all scored jobs, continue with date-sorted unscored jobs
  // so pagination covers the whole catalog (same UX as the legacy path).
  if (!hasScoreFilter && pageDocs.length < limit && catalogTotal > skip + pageDocs.length) {
    // How many scored rows precede the fill. With volatile filters the cheap
    // row count overstates it (some scored jobs fail the job-side filters), so
    // count through the same lookup instead.
    let rankedCount;
    if (hasVolatileFilters(listBody)) {
      const counted = await jobMatchScoresCollection
        .aggregate([
          { $match: scoreMatch },
          {
            $lookup: {
              from: 'job_market',
              localField: 'jobId',
              foreignField: '_id',
              pipeline: [{ $match: mongoQuery || {} }, { $project: { _id: 1 } }],
              as: 'job',
            },
          },
          { $unwind: '$job' },
          { $count: 'n' },
        ])
        .toArray();
      rankedCount = counted[0]?.n ?? 0;
    } else {
      rankedCount = await countScoresForApplier(applierName, prefilters);
    }

    const needed = limit - pageDocs.length;
    const dateSkip = Math.max(0, skip - rankedCount);
    const fillDocs = await jobsCollection
      .aggregate([
        { $match: mongoQuery || {} },
        { $sort: { postedAt: -1, _id: -1 } },
        {
          $lookup: {
            from: 'job_match_scores',
            let: { jid: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$applierName', applierName] },
                      { $eq: ['$jobId', '$$jid'] },
                    ],
                  },
                },
              },
              { $project: { _id: 1 } },
            ],
            as: 'scored',
          },
        },
        { $match: { scored: { $size: 0 } } },
        { $project: { ...JOB_LIST_PROJECTION, scored: 0 } },
        { $skip: dateSkip },
        { $limit: needed },
      ])
      .toArray();

    pageDocs = [
      ...pageDocs,
      ...fillDocs.map((j) => ({
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
    recommendationMaterialized: true,
  };
}

/**
 * Dispatcher for sort=recommended: materialized read when rows exist, legacy
 * in-memory scorer while the first rescore is still building (warming) or when
 * the materialized path is disabled.
 */
export async function listRecommendedJobs(params) {
  const { applierName } = params;
  const name = String(applierName || '').trim();

  if (!isMaterializedRecommendationEnabled() || !jobMatchScoresCollection || !name) {
    return matchJobsForApplier(params);
  }

  if (isFirestoreRuntime()) {
    const cachedMeta = firestoreRecommendationMeta.get(name);
    const readyMeta = cachedMeta?.profileCtx && cachedMeta.expiresAt > Date.now()
      ? cachedMeta
      : null;
    if (!readyMeta) {
      // Metadata is advisory for the first paint. Warm it asynchronously and
      // return the already-indexed date page immediately; the next refresh
      // switches to materialized score order when rows exist.
      void refreshFirestoreRecommendationMeta(name);
      const page = await listFirestoreWarmingPage(params);
      return { ...page, recommendationWarming: true };
    }

    const hasProfile = Boolean(
      readyMeta.profileCtx.profileTokens?.length ||
      readyMeta.profileCtx.profileCompacts?.length ||
      readyMeta.profileCtx.exactSet?.size,
    );
    if (!hasProfile) {
      const page = await listFirestoreWarmingPage(params);
      return {
        ...page,
        recommendationFallback: true,
        recommendationReason: 'no_profile_skills',
        recommendationWarming: false,
      };
    }
    if (readyMeta.rowCount === 0) {
      const page = await listFirestoreWarmingPage(params);
      const warming = readyMeta.state && (readyMeta.state.status === 'pending' || readyMeta.state.status === 'running');
      return warming ? { ...page, recommendationWarming: true } : page;
    }
    return listFromMaterializedScoresFirestore({ ...params, applierName: name });
  }

  const profileCtx = await loadProfileMatchContext(name);
  const hasProfile = Boolean(
    profileCtx.profileTokens?.length || profileCtx.profileCompacts?.length || profileCtx.exactSet?.size,
  );
  if (!hasProfile) {
    // Same "no analyzed resumes" fallback contract as the legacy path.
    return matchJobsForApplier(params);
  }

  const rowCount = await countScoresForApplier(name);
  if (rowCount === 0) {
    const state = await getRescoreState(name);
    const warming = state && (state.status === 'pending' || state.status === 'running');
    const result = await matchJobsForApplier(params);
    return warming ? { ...result, recommendationWarming: true } : result;
  }

  return listFromMaterializedScores({ ...params, applierName: name });
}

/**
 * Best Match over job_market + external_scraped_jobs via materialized scores.
 * Scored jobs from both catalogs are merged by score; unscored tail fills by date.
 */
export async function listMergedRecommendedJobs({
  applierName,
  marketQuery,
  externalQuery,
  scoreFilters,
  listBody,
  skip,
  limit,
}) {
  const name = String(applierName || '').trim();
  if (!isMaterializedRecommendationEnabled() || !jobMatchScoresCollection || !name) {
    const marketResult = await matchJobsForApplier({
      applierName: name,
      mongoQuery: marketQuery,
      scoreFilters,
      listBody,
      skip,
      limit,
    });
    const externalTotal = externalScrapedJobsCollection
      ? await externalScrapedJobsCollection.countDocuments(externalQuery || {})
      : 0;
    return {
      ...marketResult,
      total: (marketResult.total ?? 0) + externalTotal,
      catalogTotal: marketResult.catalogTotal ?? marketResult.total ?? 0,
    };
  }

  const profileCtx = await loadProfileMatchContext(name);
  const hasProfile = Boolean(
    profileCtx.profileTokens?.length || profileCtx.profileCompacts?.length || profileCtx.exactSet?.size,
  );
  if (!hasProfile) {
    return matchJobsForApplier({
      applierName: name,
      mongoQuery: marketQuery,
      scoreFilters,
      listBody,
      skip,
      limit,
    });
  }

  const prefilters = buildScoreRowPrefilters(listBody);
  const scoreRange = buildScoreRangeClause(scoreFilters);
  const hasScoreFilter = scoreRange !== null;
  const scoreMatch = { applierName: name, ...prefilters };
  if (scoreRange) scoreMatch.score = scoreRange;

  const [marketTotal, externalTotal] = await Promise.all([
    jobsCollection.countDocuments(marketQuery || {}),
    externalScrapedJobsCollection
      ? externalScrapedJobsCollection.countDocuments(externalQuery || {})
      : Promise.resolve(0),
  ]);
  const catalogTotal = marketTotal + externalTotal;

  const pageRows = await jobMatchScoresCollection
    .aggregate([
      { $match: scoreMatch },
      { $sort: { score: -1, postedAt: -1, jobId: -1 } },
      {
        $lookup: {
          from: 'job_market',
          localField: 'jobId',
          foreignField: '_id',
          pipeline: [{ $match: marketQuery || {} }, { $project: JOB_LIST_PROJECTION }],
          as: 'marketJob',
        },
      },
      {
        $lookup: {
          from: 'external_scraped_jobs',
          localField: 'jobId',
          foreignField: '_id',
          pipeline: [{ $match: externalQuery || {} }],
          as: 'externalJob',
        },
      },
      {
        $addFields: {
          hasMarket: { $gt: [{ $size: '$marketJob' }, 0] },
          hasExternal: { $gt: [{ $size: '$externalJob' }, 0] },
        },
      },
      { $match: { $or: [{ hasMarket: true }, { hasExternal: true }] } },
      { $skip: skip },
      { $limit: limit },
    ])
    .toArray();

  let pageDocs = pageRows.map((row) => {
    if (row.hasMarket) return composePageDoc(row.marketJob[0], profileCtx);
    return composePageDoc(normalizeExternalScrapedJob(row.externalJob[0]), profileCtx);
  });

  if (!hasScoreFilter && pageDocs.length < limit && catalogTotal > skip + pageDocs.length) {
    const rankedCount = await jobMatchScoresCollection.countDocuments(scoreMatch);
    const needed = limit - pageDocs.length;
    const dateSkip = Math.max(0, skip - rankedCount);

    const unscoredMarket = await jobsCollection
      .aggregate([
        { $match: marketQuery || {} },
        { $sort: { postedAt: -1, _id: -1 } },
        {
          $lookup: {
            from: 'job_match_scores',
            let: { jid: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$applierName', name] },
                      { $eq: ['$jobId', '$$jid'] },
                    ],
                  },
                },
              },
              { $project: { _id: 1 } },
            ],
            as: 'scored',
          },
        },
        { $match: { scored: { $size: 0 } } },
        { $project: { ...JOB_LIST_PROJECTION, scored: 0 } },
      ])
      .toArray();

    let unscoredExternal = [];
    if (externalScrapedJobsCollection) {
      unscoredExternal = await externalScrapedJobsCollection
        .aggregate([
          { $match: externalQuery || {} },
          { $sort: { createdAt: -1, _id: -1 } },
          {
            $lookup: {
              from: 'job_match_scores',
              let: { jid: '$_id' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$applierName', name] },
                        { $eq: ['$jobId', '$$jid'] },
                      ],
                    },
                  },
                },
                { $project: { _id: 1 } },
              ],
              as: 'scored',
            },
          },
          { $match: { scored: { $size: 0 } } },
          { $project: { scored: 0 } },
        ])
        .toArray();
    }

    const unscoredMerged = [
      ...unscoredMarket.map((j) => ({
        doc: j,
        sortAt: new Date(j.postedAt || j._createdAt || 0).getTime(),
        catalog: 'market',
      })),
      ...unscoredExternal.map((j) => ({
        doc: normalizeExternalScrapedJob(j),
        sortAt: new Date(j.postedAt || j.createdAt || 0).getTime(),
        catalog: 'external',
      })),
    ]
      .sort((a, b) => b.sortAt - a.sortAt)
      .slice(dateSkip, dateSkip + needed);

    pageDocs = [
      ...pageDocs,
      ...unscoredMerged.map(({ doc }) => ({
        ...doc,
        ...composeJobScores(doc, { matchScore: 0, covered: [], missing: [], required: 0 }),
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
    recommendationMaterialized: true,
  };
}
