const DEFAULT_LOGO =
	'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQGRo4_tzLdMlx9Bzp9ZyFGo0VdeHbJt_rfYQ&s';

function asString(value) {
	if (value == null) return '';
	return String(value).trim();
}

function joinLines(items) {
	if (!Array.isArray(items)) return '';
	return items.map((s) => asString(s)).filter(Boolean).join('\n');
}

function splitCategories(raw) {
	if (Array.isArray(raw)) return raw.map(asString).filter(Boolean);
	if (typeof raw !== 'string' || !raw.trim()) return [];
	return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function mapSkills(jobResult) {
	const core = Array.isArray(jobResult?.jdCoreSkills)
		? jobResult.jdCoreSkills.map((s) => asString(s?.skill || s?.displayName || s)).filter(Boolean)
		: [];
	if (core.length) return [...new Set(core)];

	const matched = Array.isArray(jobResult?.skillMatchingScores)
		? jobResult.skillMatchingScores
			.filter((s) => Number(s?.score) > 0)
			.map((s) => asString(s?.displayName || s?.featureName))
			.filter(Boolean)
		: [];
	return [...new Set(matched)];
}

function mapDescription(jobResult) {
	const parts = [];
	const resp = joinLines(jobResult?.coreResponsibilities);
	if (resp) parts.push(`Responsibilities\n${resp}`);
	const quals = joinLines(jobResult?.skillSummaries);
	if (quals) parts.push(`Qualification\n${quals}`);
	const benefits = joinLines(jobResult?.benefitsSummaries);
	if (benefits) parts.push(`Benefits\n${benefits}`);
	if (!parts.length && jobResult?.jobSummary) {
		parts.push(asString(jobResult.jobSummary));
	}
	return parts.join('\n\n');
}

/** Build details object; omit empty keys to match Extension/Athens docs. */
function mapDetails(jobResult) {
	const years = jobResult?.minYearsOfExperience;
	const date =
		years != null && years !== ''
			? `${years}+ years exp`
			: '';

	const details = {
		position: asString(jobResult?.jobLocation || (Array.isArray(jobResult?.jobLocations) ? jobResult.jobLocations[0] : '')),
		time: asString(jobResult?.employmentType),
		remote: asString(jobResult?.workModel || (jobResult?.isRemote ? 'Remote' : '')),
		seniority: asString(jobResult?.jobSeniority),
		money: asString(jobResult?.salaryDesc),
		date,
	};

	return Object.fromEntries(
		Object.entries(details).filter(([, value]) => value !== ''),
	);
}

/**
 * Map one Jobright list item to Athens-server POST /jobs body (Extension shape).
 * Returns jobrightJobId separately for swan/job/apply — do not POST it.
 * @param {{ jobResult?: object, companyResult?: object }} item
 * @returns {{ resultData: object, jobrightJobId: string }}
 */
export function mapJobrightItemToResultData(item) {
	const jobResult = item?.jobResult || {};
	const companyResult = item?.companyResult || {};
	const jobrightJobId = asString(jobResult.jobId);

	const resultData = {
		applyLink: asString(jobResult.applyLink || jobResult.originalUrl),
		id: Date.now(),
		postedAgo: asString(jobResult.publishTimeDesc),
		company: {
			name: asString(companyResult.companyName),
			tags: splitCategories(companyResult.companyCategories),
			logo: asString(jobResult.jdLogo) || DEFAULT_LOGO,
		},
		title: asString(jobResult.jobTitle || jobResult.jobNlpTitle),
		details: mapDetails(jobResult),
		description: mapDescription(jobResult),
		skills: mapSkills(jobResult),
		companyLink: asString(companyResult.companyURL),
	};

	return { resultData, jobrightJobId };
}
