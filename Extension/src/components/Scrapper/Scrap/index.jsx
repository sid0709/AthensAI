import { useState, useEffect, useRef, useCallback } from 'react';

import {
	Button,
	Divider,
	CircularProgress,
	Typography,
	Paper,
	Stack,
	Box,
} from '@mui/material';

import { PlayArrow, Stop } from '@mui/icons-material';
import PropTypes from 'prop-types';
import { useRuntime } from '../../../api/runtimeContext';
import useApi from '../../../api/useApi';
import { API_URL } from '../../../config/env';
import useNotification from '../../../api/useNotification';
import { handleClear, handleAction, handleHighlight } from '../../../contentScript/interactionBridge';
import { athensCardSx, athensSectionLabelSx } from '../../../theme/athensTheme';

function CircularProgressWithLabel(props) {
	return (
		<Box sx={{ position: 'relative', display: 'inline-flex' }}>
			<CircularProgress variant="determinate" {...props} />
			<Box
				sx={{
					top: 0,
					left: 0,
					bottom: 0,
					right: 0,
					position: 'absolute',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
				}}
			>
				<Typography
					variant="caption"
					component="div"
					sx={{ color: 'text.secondary' }}
				>
					{`${Math.round(props.value)}%`}
				</Typography>
			</Box>
		</Box>
	);
}

CircularProgressWithLabel.propTypes = {
	value: PropTypes.number.isRequired,
};

const ScrapComponent = () => {
	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	const [progress, setProgress] = useState(0);
	const [scrapFlag, setScrapFlag] = useState(false);

	const { addListener, removeListener } = useRuntime();
	const api = useApi(API_URL);
	const notification = useNotification();
	const pendingResolvers = useRef(new Map());

	const notifyFailure = useCallback((err, fallback) => {
		notification.fail(err, { key: 'scrap-failure' });
		if (fallback) console.error(fallback, err);
	}, [notification]);

	useEffect(() => {
		const listener = (message) => {
			if (message?.action === 'fetchResult') {
				const id = message.payload?.identifier;
				if (id) {
					const resolver = pendingResolvers.current.get(id);
					if (resolver) {
						resolver(message.payload);
						pendingResolvers.current.delete(id);
					}
				}
			}
		};
		addListener(listener);
		return () => removeListener(listener);
	}, [addListener, removeListener]);

	async function onClickListItem() {
		handleClear();
		handleHighlight("div", "class", "?index_job-card-main-flip1-?");
		handleAction("div", "class", "?index_job-card-main-flip1-?", 0, "click", "");
		await delay(250);
		handleClear();
		setProgress(10);

		handleClear();

		let id = `scrap_wait_for_details_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_waitfor_jobdetails = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("div", "class", "?index_jobdetail-enter?", 0, "fetch", null, "text", id);
		await promise_waitfor_jobdetails;
		await delay(250);

		handleHighlight("img", "class", "?index_company-logo-img__?");
		id = `scrap_logo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_logo = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("img", "class", "?index_company-logo-img__?", 0, "fetch", null, "src", id);
		const CompanyLogoComponent = await promise_logo;
		const CompanyLogo = CompanyLogoComponent?.success ? (new DOMParser().parseFromString(CompanyLogoComponent.data, 'text/html')).querySelector('img')?.src : null;
		handleClear();
		setProgress(12);
		await delay(100);
		handleClear();

		handleHighlight("a", "class", "?index_origin__?");
		id = `scrap_apply_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_applyLink = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("a", "class", "?index_origin__?", 0, "fetch", null, "content", id);
		const LinkComponent = await promise_applyLink;

		const ApplyLink = LinkComponent?.success ? (new DOMParser().parseFromString(LinkComponent.data, 'text/html')).querySelector('a')?.href : null;
		setProgress(15);
		await delay(100);
		handleClear();

		handleHighlight("div", "class", "?index_jobTag__?");
		id = `scrap_applicants_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_jobTag = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("div", "class", "?index_jobTag__?", 0, "fetch", null, "text", id);
		const ApplicantsNumber = await promise_jobTag;
		setProgress(20);
		await delay(100);
		handleClear();

		handleHighlight("h2", "class", "?index_company-row__?");
		id = `scrap_company_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_companyRow = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("h2", "class", "?index_company-row__?", 0, "fetch", null, "content", id);
		const CompanyRawComponent = await promise_companyRow;
		let CompanyName = null;
		let PublishTime = null;

		if (CompanyRawComponent?.success) {
			const doc = new DOMParser().parseFromString(CompanyRawComponent.data, 'text/html');
			const spans = doc.querySelectorAll('span');

			CompanyName = spans[0]?.innerText || null;
			PublishTime = spans[1]?.innerText.replace(' · ', '') || null;
		}

		setProgress(25);
		await delay(100);
		handleClear();

		handleHighlight("h1", "class", "?index_job-title__?");
		id = `scrap_title_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_jobTitle = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("h1", "class", "?index_job-title__?", 0, "fetch", null, "text", id);
		const JobTitle = await promise_jobTitle;
		setProgress(30);
		await delay(100);
		handleClear();

		handleHighlight("div", "class", "?index_job-metadata-row__?");
		id = `scrap_meta_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_job_metadata = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("div", "class", "?index_job-metadata-row__?", 0, "fetch", null, "content", id);

		const MetaTagsComponent = await promise_job_metadata;
		const MetaTags = (() => {
			if (!MetaTagsComponent?.success || !MetaTagsComponent?.data) return {};
			const doc = new DOMParser().parseFromString(MetaTagsComponent.data, 'text/html');
			const items = doc.querySelectorAll('div[class*="index_job-metadata-item__"]');
			return Array.from(items).reduce((acc, div) => {
				const key = div.querySelector('img')?.getAttribute('alt');
				const value = div.querySelector('span')?.textContent?.trim();
				if (key && value) acc[key] = value;
				return acc;
			}, {});
		})();
		setProgress(35);
		await delay(100);
		handleClear();

		handleHighlight("div", "class", "?index_company-summary__?");
		id = `scrap_summary_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_company_summary = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("div", "class", "?index_company-summary__?", 0, "fetch", null, "text", id);
		const CompanySummary = await promise_company_summary;
		setProgress(40);
		await delay(100);
		handleClear();

		handleHighlight("div", "class", "?index_companyTags?");
		id = `scrap_tags_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_companyTags = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("div", "class", "?index_companyTags?", 0, "fetch", null, "content", id);
		const CompanyTagsComponent = await promise_companyTags;
		const CompanyTags = CompanyTagsComponent?.success ? Array.from((new DOMParser().parseFromString(CompanyTagsComponent.data, 'text/html')).querySelectorAll('span.ant-tag')).map(span => span.innerText) : [];
		setProgress(45);
		await delay(100);
		handleClear();

		handleHighlight("section", "class", "?index_sectionContent__?");
		id = `scrap_resp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_sectionContent1 = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("section", "class", "?index_sectionContent__?", 2, "fetch", null, "text", id);
		const Responsibilities = await promise_sectionContent1;
		setProgress(50);
		await delay(100);
		handleClear();

		handleHighlight("section", "class", "?index_sectionContent__?");
		id = `scrap_qual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_sectionContent2 = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("section", "class", "?index_sectionContent__?", 3, "fetch", null, "text", id);
		const Qualification = await promise_sectionContent2;
		setProgress(55);
		await delay(100);
		handleClear();

		handleHighlight("section", "class", "?index_sectionContent__?");
		id = `scrap_ben_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_sectionContent3 = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("section", "class", "?index_sectionContent__?", 4, "fetch", null, "text", id);
		const Benefits = await promise_sectionContent3;
		setProgress(60);
		await delay(100);
		handleClear();

		handleHighlight("div", "class", "?index_skill-matching-tags-area__?");
		id = `scrap_skill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_skill_matching = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("div", "class", "?index_skill-matching-tags-area__?", 0, "fetch", null, "text", id);
		const SkillMatching = await promise_skill_matching;
		const Skills = SkillMatching?.success ? SkillMatching.data.split('\n').map(s => s.trim()).filter(Boolean) : [];
		setProgress(65);
		handleClear();
		await delay(250);
		setProgress(70);

		handleHighlight("a", "class", "index_company-link?");
		id = `scrap_company_link_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
		const promise_company_link = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
		handleAction("a", "class", "index_company-link?", 0, "fetch", null, "content", id);
		const CompanyLink = await promise_company_link;
		// Mirror ApplyLink: fetch the anchor's HTML and read its href so we store
		// the company URL, not the link text.
		const CompanyLinkUrl = CompanyLink?.success
			? (new DOMParser().parseFromString(CompanyLink.data, 'text/html')).querySelector('a')?.href || ""
			: "";
		setProgress(75);
		handleClear();
		await delay(250);
		setProgress(75);

		handleHighlight("button", "id", "index_not-interest-button__?");
		handleAction("button", "id", "index_not-interest-button__?", 0, "click", "");
		await delay(250);
		setProgress(80);

		handleHighlight("li", "class", "ant-dropdown-menu-item ant-dropdown-menu-item-only-child");
		handleAction("li", "class", "ant-dropdown-menu-item ant-dropdown-menu-item-only-child", 0, "click", "");
		await delay(250);
		setProgress(100);

		let success_wait_for_job_list = false;

		while (!success_wait_for_job_list) {
			id = `scrap_wait_for_list_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
			const promise_waitfor_joblist = new Promise((resolve) => pendingResolvers.current.set(id, resolve));
			handleAction("div", "class", "?index_jobdetail-leave?", 0, "fetch", null, "content", id);
			const object_waitfor_joblist = await promise_waitfor_joblist;

			success_wait_for_job_list = object_waitfor_joblist?.success;

			if (!success_wait_for_job_list) {
				await delay(600);
			}
		}

		const parseApplicantsTags = (data) => {
			return data.split('\n').map(tag => tag.trim()).filter(tag => tag);
		};

		const parsedTags = ApplicantsNumber?.success ? parseApplicantsTags(ApplicantsNumber.data) : [];

		const resultData = {
			applyLink: ApplyLink || "",
			id: Date.now(),
			postedAgo: PublishTime || "",
			tags: parsedTags,
			company: {
				name: CompanyName || "",
				tags: CompanyTags || [],
				logo: CompanyLogoComponent?.success ? CompanyLogo : "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQGRo4_tzLdMlx9Bzp9ZyFGo0VdeHbJt_rfYQ&s",
			},
			title: JobTitle?.success ? JobTitle.data : "",
			details: MetaTags || {},
			applicants: ApplicantsNumber?.success ? { count: parseInt(ApplicantsNumber.data.match(/\d+/)?.[0] || "0", 10), text: ApplicantsNumber.data } : { count: 0, text: "" },
			description: [Responsibilities?.success ? Responsibilities.data : "", Qualification?.success ? Qualification.data : "", Benefits?.success ? Benefits.data : ""].filter(s => s).join("\n\n"),
			skills: Skills || [],
			companyLink: CompanyLinkUrl,
		};

		console.log('Scraped job data:', resultData);

		try {
			await api.post('/jobs', resultData);
			notification.success('Job saved to backend');
		} catch (err) {
			notifyFailure(err, 'Failed to save job');
			throw err;
		}

		setProgress(0);
		handleClear();
		await delay(250);
	}

	useEffect(() => {
		let active = true;

		const run = async () => {
			while (active && scrapFlag) {
				try {
					await onClickListItem();
				} catch (err) {
					notifyFailure(err, 'Error in scrape loop');
				}
			}
		};

		if (scrapFlag) {
			run();
		}

		return () => {
			active = false;
		};
	}, [scrapFlag, notifyFailure]);

	const onScrapStart = () => {
		if (!api.baseUrl) {
			notifyFailure(new Error('API base URL is not configured'));
			return;
		}
		setScrapFlag(true);
	};

	const onScrapStop = () => {
		setScrapFlag(false);
		setProgress(0);
	};

	return (
		<Paper sx={{ ...athensCardSx, mx: 'auto' }}>
			<Stack spacing={2.5}>
				<Box>
					<Typography sx={athensSectionLabelSx} component="p" gutterBottom>
						Automation
					</Typography>
					<Typography variant="h5" component="h2">
						Scraping Controls
					</Typography>
				</Box>
				<Divider />

				<Stack
					direction="row"
					spacing={2}
					justifyContent="center"
					alignItems="center"
					sx={{
						py: 2.5,
						borderRadius: 3,
						bgcolor: 'secondary.main',
						border: '1px solid',
						borderColor: 'divider',
					}}
				>
					<CircularProgressWithLabel size={72} value={progress} thickness={4} />
				</Stack>

				<Stack direction="row" spacing={1.5}>
					<Button
						variant="outlined"
						color="error"
						onClick={onScrapStop}
						disabled={!scrapFlag}
						startIcon={<Stop />}
						fullWidth
					>
						Stop
					</Button>
					<Button
						variant="contained"
						onClick={onScrapStart}
						disabled={scrapFlag}
						startIcon={<PlayArrow />}
						fullWidth
					>
						Start
					</Button>
				</Stack>
			</Stack>
		</Paper>
	);
};

export default ScrapComponent;
