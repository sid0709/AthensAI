/**
 * Infer catalog `source` label from an apply/job URL host.
 * Token list mirrors the published Job Search source filter contract.
 */
const SOURCE_HOST_TOKENS: ReadonlyArray<{ token: string; title: string }> = [
  { token: 'linkedin.com', title: 'LinkedIn' },
  { token: 'indeed.com', title: 'Indeed' },
  { token: 'ziprecruiter.com', title: 'ZipRecruiter' },
  { token: 'wellfound.com', title: 'Wellfound' },
  { token: 'greenhouse.io', title: 'Greenhouse' },
  { token: 'myworkdayjobs.com', title: 'Workday' },
  { token: 'myworkdaysite.com', title: 'Workday' },
  { token: 'workable.com', title: 'Workable' },
  { token: 'ashbyhq.com', title: 'Ashby' },
  { token: 'lever.co', title: 'Lever' },
  { token: 'jobvite.com', title: 'Jobvite' },
  { token: 'smartrecruiters.com', title: 'SmartRecruiters' },
  { token: 'bamboohr.com', title: 'BambooHR' },
  { token: 'recruitee.com', title: 'Recruitee' },
  { token: 'teamtailor.com', title: 'Teamtailor' },
  { token: 'personio.com', title: 'Personio' },
  { token: 'rippling.com', title: 'Rippling' },
  { token: 'dover.com', title: 'Dover' },
  { token: 'applytojob.com', title: 'Applytojob' },
  { token: 'jobdiva.com', title: 'Jobdiva' },
  { token: 'breezy.hr', title: 'Breezy' },
  { token: 'gusto.com', title: 'Gusto' },
  { token: 'rippling-ats.com', title: 'Rippling-ATS' },
  { token: 'pinpointhq.com', title: 'Pinpointhq' },
  { token: 'freshteam.com', title: 'Freshteam' },
  { token: 'recruiterflow.com', title: 'Recruiterflow' },
  { token: 'gem.com', title: 'Gem' },
  { token: 'oraclecloud.com', title: 'OracleCloud' },
  { token: 'paylocity.com', title: 'Paylocity' },
  { token: 'adp.com', title: 'ADP' },
  { token: 'icims.com', title: 'iCIMS' },
  { token: 'ultipro.com', title: 'UltiPro' },
  { token: 'ukg.net', title: 'UKG' },
  { token: 'paycomonline.net', title: 'Paycom' },
  { token: 'dayforcehcm.com', title: 'DayforceHCM' },
  { token: 'zohorecruit.com', title: 'Zohorecruit' },
  { token: 'bestjobtool.com', title: 'BestJobTool' },
  { token: 'taleo.net', title: 'Taleo' },
].sort((a, b) => b.token.length - a.token.length);

export function inferJobSource(applyLink: string | null | undefined): string {
  const url = String(applyLink ?? '')
    .trim()
    .toLowerCase();
  if (!url) return 'Other';

  let host = url;
  if (host.startsWith('https://')) host = host.slice(8);
  else if (host.startsWith('http://')) host = host.slice(7);
  const slash = host.indexOf('/');
  if (slash !== -1) host = host.slice(0, slash);

  for (const { token, title } of SOURCE_HOST_TOKENS) {
    if (host.includes(token)) return title;
  }
  return 'Other';
}
