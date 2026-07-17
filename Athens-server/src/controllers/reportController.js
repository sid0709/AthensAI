import { jobsCollection, accountInfoCollection } from "../db/mongo.js";

/**
 * Job source comes from the denormalized, indexed `source` field (set at
 * insert / startup backfill from the apply-link hostname) instead of running
 * a regex `$switch` over `applyLink` for every document.
 */
const SOURCE_EXPR = { $ifNull: ['$source', 'Other'] };

/** Calendar window from query (ISO). Both dates required unless allTime — then no date window here. */
function parseReportDateRange(req) {
	const q = req.query || {};
	if (q.allTime === '1' || q.allTime === 'true') return null;
	const { startDate, endDate } = q;
	if (!startDate || !endDate) return null;
	const start = new Date(startDate);
	const end = new Date(endDate);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
	return { start, end };
}

/**
 * Date fields are stored as ISO-8601 strings, which compare lexicographically,
 * so plain string range matches are equivalent to `$expr + $toDate` — but they
 * can use indexes (e.g. `{ postedAt: -1 }`) instead of scanning every document.
 */
function isoRangeCond(range) {
	if (!range) return null;
	return { $gte: range.start.toISOString(), $lte: range.end.toISOString() };
}

export async function getDailyApplications(req, res) {
	try {
		if (!jobsCollection) {
			return res.status(503).json({ success: false, error: "Database not ready" });
		}

		// Optional applier filter
		let applierId = null;
		if (req.query?.applierName && accountInfoCollection) {
			const applier = await accountInfoCollection.findOne({ name: req.query.applierName });
			applierId = applier?._id || null;
		}

		const range = parseReportDateRange(req);
		const appliedDateCond = isoRangeCond(range) ?? { $exists: true };
		const appliedDateClauses = [
			{ "status.appliedDate": appliedDateCond },
			...(applierId ? [{ "status.applier": applierId }] : []),
		];

		const dailyApplications = await jobsCollection.aggregate([
			// Narrow to documents with a matching status entry before unwinding.
			{
				$match: {
					status: {
						$elemMatch: {
							appliedDate: appliedDateCond,
							...(applierId ? { applier: applierId } : {}),
						},
					},
				},
			},
			{
				$unwind: "$status"
			},
			{
				$match: { $and: appliedDateClauses }
			},
			{
				$project: {
					date: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$status.appliedDate" } } }
				}
			},
			{
				$group: {
					_id: "$date",
					value: { $sum: 1 }
				}
			},
			{
				$project: {
					_id: 0,
					date: "$_id",
					value: 1
				}
			},
			{
				$sort: {
					date: 1
				}
			}
		]).toArray();

		res.json({ success: true, data: dailyApplications });
	} catch (err) {
		console.error('GET /api/reports/daily-applications error', err);
		res.status(500).json({ success: false, error: err.message });
	}
}

export async function getJobSources(req, res) {
	try {
		if (!jobsCollection) {
			return res.status(503).json({ success: false, error: "Database not ready" });
		}

		const rangeJs = parseReportDateRange(req);
		const postedCond = isoRangeCond(rangeJs);
		const postedInRange = postedCond ? [{ $match: { postedAt: postedCond } }] : [];

		const jobSources = await jobsCollection.aggregate([
			...postedInRange,
			{
				$group: {
					_id: SOURCE_EXPR,
					value: { $sum: 1 }
				}
			},
			{
				$project: {
					_id: 0,
					source: "$_id",
					value: 1
				}
			}
		]).toArray();

		// The frontend already handles filling in sources with 0 counts,
		// so we don't need to add that logic here. We only return sources that exist in the DB.

		res.json({ success: true, data: jobSources });
	} catch (err) {
		console.error('GET /api/reports/job-sources error', err);
		res.status(500).json({ success: false, error: err.message });
	}
}

export async function getJobSourceSummary(req, res) {
	try {
		if (!jobsCollection) {
			return res.status(503).json({ success: false, error: "Database not ready" });
		}

		// Optional applier filter
		let applierId = null;
		if (req.query?.applierName && accountInfoCollection) {
			const applier = await accountInfoCollection.findOne({ name: req.query.applierName });
			applierId = applier?._id || null;
		}
		const range = parseReportDateRange(req);
		const postedCond = isoRangeCond(range);
		const postingRangeMatch = postedCond ? [{ $match: { postedAt: postedCond } }] : [];

		const statusDateCond = isoRangeCond(range) ?? { $exists: true };
		const applierElem = applierId ? { applier: applierId } : {};
		const applierClauses = applierId ? [{ "status.applier": applierId }] : [];

		// Each status facet pre-filters with $elemMatch (a superset of the
		// post-$unwind match) so unwinding only touches relevant documents.
		const statusFacet = (dateField, dateCond, extraClauses = []) => [
			{ $match: { status: { $elemMatch: { [dateField]: dateCond, ...applierElem } } } },
			{ $unwind: { path: "$status", preserveNullAndEmptyArrays: false } },
			{ $match: { $and: [{ [`status.${dateField}`]: dateCond }, ...applierClauses, ...extraClauses] } },
			{ $group: { _id: SOURCE_EXPR, count: { $sum: 1 } } },
		];

		const jobSourceSummary = await jobsCollection.aggregate([
			{
				$facet: {
					postings: [...postingRangeMatch, { $group: { _id: SOURCE_EXPR, count: { $sum: 1 } } }],
					applied: statusFacet("appliedDate", statusDateCond, [
						{ $or: [{ "status.scheduledDate": { $exists: false } }, { "status.scheduledDate": null }] },
						{ $or: [{ "status.declinedDate": { $exists: false } }, { "status.declinedDate": null }] },
					]),
					scheduled: statusFacet("scheduledDate", statusDateCond),
					declined: statusFacet("declinedDate", statusDateCond),
				}
			},
			// Combine facet outputs into a single array of documents per source
			{
				$project: {
					allSources: {
						$setUnion: [
							{ $map: { input: "$postings", as: "p", in: "$$p._id" } },
							{ $map: { input: "$applied", as: "a", in: "$$a._id" } },
							{ $map: { input: "$scheduled", as: "s", in: "$$s._id" } },
							{ $map: { input: "$declined", as: "d", in: "$$d._id" } }
						]
					},
					postings: 1,
					applied: 1,
					scheduled: 1,
					declined: 1
				}
			},
			{ $unwind: "$allSources" },
			{
				$project: {
					_id: 0,
					source: "$allSources",
					postings: {
						$let: {
							vars: { match: { $first: { $filter: { input: "$postings", as: "p", cond: { $eq: ["$$p._id", "$allSources"] } } } } },
							in: { $ifNull: [ "$$match.count", 0 ] }
						}
					},
					applied: {
						$let: {
							vars: { match: { $first: { $filter: { input: "$applied", as: "a", cond: { $eq: ["$$a._id", "$allSources"] } } } } },
							in: { $ifNull: [ "$$match.count", 0 ] }
						}
					},
					scheduled: {
						$let: {
							vars: { match: { $first: { $filter: { input: "$scheduled", as: "s", cond: { $eq: ["$$s._id", "$allSources"] } } } } },
							in: { $ifNull: [ "$$match.count", 0 ] }
						}
					},
					declined: {
						$let: {
							vars: { match: { $first: { $filter: { input: "$declined", as: "d", cond: { $eq: ["$$d._id", "$allSources"] } } } } },
							in: { $ifNull: [ "$$match.count", 0 ] }
						}
					}
				}
			}
		]).toArray();

		res.json({ success: true, data: jobSourceSummary });
	} catch (err) {
		console.error('GET /api/reports/job-source-summary error', err);
		res.status(500).json({ success: false, error: err.message });
	}
}

export async function getJobPostingFrequency(req, res) {
	try {
		if (!jobsCollection) {
			return res.status(503).json({ success: false, error: "Database not ready" });
		}

		const { startDate, endDate } = req.query;
		const start = startDate ? new Date(startDate) : new Date(0);
		const end = endDate ? new Date(endDate) : new Date();

		const data = await jobsCollection.aggregate([
			{
				$match: {
					postedAt: { $gte: start.toISOString(), $lte: end.toISOString() }
				}
			},
			{
				$project: {
					date: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$postedAt" } } },
					hour: { $hour: { $toDate: "$postedAt" } }
				}
			},
			{
				$group: {
					_id: {
						date: "$date",
						hour: "$hour"
					},
					count: { $sum: 1 }
				}
			},
			{
				$group: {
					_id: "$_id.date",
					hourlyData: {
						$push: {
							hour: "$_id.hour",
							count: "$count"
						}
					}
				}
			},
			{
				$sort: { _id: 1 }
			}
		]).toArray();

		res.json({ success: true, data });
	} catch (err) {
		console.error('GET /api/reports/job-posting-frequency error', err);
		res.status(500).json({ success: false, error: err.message });
	}
}

export async function getJobApplicationFrequency(req, res) {
	try {
		if (!jobsCollection) {
			return res.status(503).json({ success: false, error: "Database not ready" });
		}

		const { startDate, endDate } = req.query;
		let applierId = null;
		if (req.query?.applierName && accountInfoCollection) {
			const applier = await accountInfoCollection.findOne({ name: req.query.applierName });
			applierId = applier?._id || null;
		}
		const start = startDate ? new Date(startDate) : new Date(0);
		const end = endDate ? new Date(endDate) : new Date();
		const appliedDateCond = { $gte: start.toISOString(), $lte: end.toISOString() };

		const data = await jobsCollection.aggregate([
			// Narrow to documents with a matching status entry before unwinding.
			{
				$match: {
					status: {
						$elemMatch: {
							appliedDate: appliedDateCond,
							...(applierId ? { applier: applierId } : {}),
						},
					},
				},
			},
			{ $unwind: "$status" },
			{
				$match: Object.assign(
					{ "status.appliedDate": appliedDateCond },
					applierId ? { "status.applier": applierId } : {}
				)
			},
			{
				$project: {
					date: { $dateToString: { format: "%Y-%m-%d", date: { $toDate: "$status.appliedDate" } } },
					hour: { $hour: { $toDate: "$status.appliedDate" } }
				}
			},
			{
				$group: {
					_id: {
						date: "$date",
						hour: "$hour"
					},
					count: { $sum: 1 }
				}
			},
			{
				$group: {
					_id: "$_id.date",
					hourlyData: {
						$push: {
							hour: "$_id.hour",
							count: "$count"
						}
					}
				}
			},
			{
				$sort: { _id: 1 }
			}
		]).toArray();

		res.json({ success: true, data });
	} catch (err) {
		console.error('GET /api/reports/job-application-frequency error', err);
		res.status(500).json({ success: false, error: err.message });
	}
}
