import { jobsCollection, externalScrapedJobsCollection } from '../db/mongo.js';
import { buildJobsListQuery, JOB_LIST_PROJECTION } from './jobListQuery.js';
import { listMergedRecommendedJobs } from './matching/matchScoreReader.js';
import {
	buildExternalScrapedJobsQuery,
	shouldMergeExternal,
	resolveStatusTabFromBody,
} from './externalScrapedJobsListQuery.js';

function parseSortOption(sort) {
	const sortOption = { _listPostedAt: -1, _id: -1 };
	if (!sort || typeof sort !== 'string') return sortOption;

	const [sortField, sortOrder] = sort.split('_');
	if (sortField === 'postedAt') {
		return { _listPostedAt: sortOrder === 'asc' ? 1 : -1, _id: -1 };
	}
	if (sortField === 'title') {
		return { _listTitle: sortOrder === 'desc' ? -1 : 1, _id: -1 };
	}
	return sortOption;
}

function stripMarketListFields(doc) {
	if (!doc || doc.catalog === 'external') return doc;
	const { description, jobDescription, ...rest } = doc;
	return rest;
}

function buildExternalUnionPipeline(externalQuery) {
	return [
		{ $match: externalQuery },
		{
			$addFields: {
				catalog: 'external',
				title: '$jobTitle',
				_listPostedAt: { $ifNull: ['$postedAt', '$createdAt'] },
				_listTitle: '$jobTitle',
				company: {
					$cond: {
						if: { $and: [{ $ne: ['$company', null] }, { $eq: [{ $type: '$company' }, 'object'] }] },
						then: '$company',
						else: {
							name: { $ifNull: ['$companyName', 'Unknown'] },
							logo: '$companyIcon',
							tags: [],
						},
					},
				},
				applyLink: '$jobLink',
				jobDescription: '$jobDescription',
				description: { $ifNull: ['$description', '$jobDescription'] },
				source: {
					$cond: {
						if: { $and: [{ $ne: ['$source', null] }, { $ne: ['$source', ''] }] },
						then: '$source',
						else: 'Other',
					},
				},
				postedAgo: '$postedAgo',
				postedAt: { $ifNull: ['$postedAt', '$createdAt'] },
				details: { $ifNull: ['$details', {}] },
				aiSkills: '$aiSkills',
				skills: '$skills',
				skillsNormalized: '$skillsNormalized',
				skillTokens: '$skillTokens',
				aiSkillStatus: '$aiSkillStatus',
				aiSkillExtractedAt: '$aiSkillExtractedAt',
			},
		},
	];
}

async function listMergedByAggregation({ body, marketQuery, externalQuery, skip, limit, sort }) {
	const sortOption = parseSortOption(sort);
	const pipeline = [
		{ $match: marketQuery },
		{
			$addFields: {
				catalog: 'market',
				_listPostedAt: '$postedAt',
				_listTitle: '$title',
			},
		},
		{
			$unionWith: {
				coll: 'external_scraped_jobs',
				pipeline: buildExternalUnionPipeline(externalQuery),
			},
		},
		{ $sort: sortOption },
		{
			$facet: {
				data: [{ $skip: skip }, { $limit: limit }],
				meta: [{ $count: 'total' }],
			},
		},
	];

	const [result] = await jobsCollection.aggregate(pipeline).toArray();
	const docs = (result?.data || []).map(stripMarketListFields);
	const total = result?.meta?.[0]?.count ?? 0;
	return { docs, total };
}

async function listMergedRecommended({ body, marketQuery, externalQuery, scoreFilters, skip, limit, applierName }) {
	const result = await listMergedRecommendedJobs({
		applierName,
		marketQuery,
		externalQuery,
		scoreFilters,
		listBody: body,
		skip,
		limit,
	});
	return {
		...result,
		recommendationReason: result.recommendationReason ?? null,
		recommendationWarming: Boolean(result.recommendationWarming),
	};
}

/**
 * List jobs from job_market, optionally merged with external_scraped_jobs.
 */
export async function listMergedJobs(body) {
	const {
		sort,
		page = 1,
		limit = 10,
		skip: skipRaw,
		applierName,
		countsOnly,
	} = body;

	const statusTab = resolveStatusTabFromBody(body);
	const mergeExternal = shouldMergeExternal(body, statusTab);

	const { query: marketQuery, scoreFilters } = await buildJobsListQuery(body);

	const pageNum = Math.max(1, parseInt(page, 10) || 1);
	const limitNum = Math.max(1, Math.min(5000, parseInt(limit, 10) || 10));
	const skip =
		skipRaw !== undefined && skipRaw !== null && skipRaw !== ''
			? Math.max(0, parseInt(skipRaw, 10) || 0)
			: (pageNum - 1) * limitNum;

	if (!mergeExternal) {
		return { mergeExternal: false, marketQuery, scoreFilters, skip, limit: limitNum, pageNum, countsOnly };
	}

	const externalQuery = buildExternalScrapedJobsQuery(body);

	if (countsOnly === true || countsOnly === 'true') {
		const [marketTotal, externalTotal] = await Promise.all([
			jobsCollection.countDocuments(marketQuery),
			externalScrapedJobsCollection.countDocuments(externalQuery),
		]);
		const total = marketTotal + externalTotal;
		return {
			mergeExternal: true,
			docs: [],
			total,
			pageNum,
			limitNum,
			recommendationFallback: false,
			recommendationReason: null,
			recommendationWarming: false,
			catalogTotal: null,
		};
	}

	const useRecommendation = sort === 'recommended' && applierName;

	if (useRecommendation) {
		const result = await listMergedRecommended({
			body,
			marketQuery,
			externalQuery,
			scoreFilters,
			skip,
			limit: limitNum,
			applierName,
		});
		return {
			mergeExternal: true,
			docs: result.docs,
			total: result.total,
			pageNum,
			limitNum,
			recommendationFallback: result.recommendationFallback,
			recommendationReason: result.recommendationReason,
			recommendationWarming: result.recommendationWarming,
			catalogTotal: result.catalogTotal,
		};
	}

	const { docs, total } = await listMergedByAggregation({
		body,
		marketQuery,
		externalQuery,
		skip,
		limit: limitNum,
		sort,
	});

	return {
		mergeExternal: true,
		docs,
		total,
		pageNum,
		limitNum,
		recommendationFallback: false,
		recommendationReason: null,
		recommendationWarming: false,
		catalogTotal: null,
	};
}

/** Add external counts to all/posted status tabs when merge is enabled. */
export async function countExternalForStatusTabs(body) {
	if (!shouldMergeExternal(body, 'all')) {
		return { all: 0, posted: 0 };
	}

	const externalQuery = buildExternalScrapedJobsQuery(body);
	const count = await externalScrapedJobsCollection.countDocuments(externalQuery);
	return { all: count, posted: count };
}

export { JOB_LIST_PROJECTION };
