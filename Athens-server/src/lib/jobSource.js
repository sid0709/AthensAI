/** Detect ATS / job board from a posting URL for vendor monitor chips. */
const SOURCE_RULES = [
	{ pattern: /ashbyhq\.com/i, label: "Ashby", color: "violet" },
	{ pattern: /greenhouse\.io/i, label: "Greenhouse", color: "emerald" },
	{ pattern: /lever\.co/i, label: "Lever", color: "blue" },
	{ pattern: /myworkdayjobs\.com|workday\.com/i, label: "Workday", color: "orange" },
	{ pattern: /workable\.com/i, label: "Workable", color: "cyan" },
	{ pattern: /smartrecruiters\.com/i, label: "SmartRecruiters", color: "indigo" },
	{ pattern: /jobvite\.com/i, label: "Jobvite", color: "rose" },
	{ pattern: /icims\.com/i, label: "iCIMS", color: "amber" },
	{ pattern: /taleo\.net/i, label: "Taleo", color: "slate" },
	{ pattern: /bamboohr\.com/i, label: "BambooHR", color: "lime" },
	{ pattern: /rippling\.com/i, label: "Rippling", color: "sky" },
	{ pattern: /linkedin\.com/i, label: "LinkedIn", color: "blue" },
	{ pattern: /indeed\.com/i, label: "Indeed", color: "blue" },
	{ pattern: /glassdoor\.com/i, label: "Glassdoor", color: "green" },
	{ pattern: /ziprecruiter\.com/i, label: "ZipRecruiter", color: "teal" },
	{ pattern: /dice\.com/i, label: "Dice", color: "red" },
	{ pattern: /monster\.com/i, label: "Monster", color: "purple" },
	{ pattern: /applytojob\.com|jazz\.co/i, label: "JazzHR", color: "pink" },
	{ pattern: /breezy\.hr/i, label: "Breezy", color: "cyan" },
	{ pattern: /recruitee\.com/i, label: "Recruitee", color: "violet" },
	{ pattern: /teamtailor\.com/i, label: "Teamtailor", color: "rose" },
	{ pattern: /oraclecloud\.com|tbe\.taleo/i, label: "Oracle", color: "red" },
	{ pattern: /successfactors\.com|sap\.com/i, label: "SAP", color: "blue" },
];

export function detectJobSource(url) {
	const raw = String(url ?? "").trim();
	if (!raw) return null;
	try {
		const host = new URL(raw).hostname.replace(/^www\./i, "");
		for (const rule of SOURCE_RULES) {
			if (rule.pattern.test(host)) {
				return { label: rule.label, color: rule.color, host };
			}
		}
		const parts = host.split(".");
		const label = parts.length >= 2 ? parts[parts.length - 2] : host;
		return {
			label: label.charAt(0).toUpperCase() + label.slice(1),
			color: "neutral",
			host,
		};
	} catch {
		return null;
	}
}
