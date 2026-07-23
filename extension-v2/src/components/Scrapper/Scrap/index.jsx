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
import useNotification from '../../../api/useNotification';
import useScraperSocket from '../../../api/useScraperSocket';
import {
	bindScraperTab,
	unbindScraperTab,
	recoverScraper,
	navigateScraperTab,
	getBackoffDelay,
	isNetworkError,
	waitMs,
} from '../../../api/scraperRecovery';
import { SCRAPER_RESTART_URL } from '../../../config/socket_protocol';
import {
	swanFetch,
	buildListJobsUrl,
	interpretSwanListResponse,
	interpretSwanApplyResponse,
	JOBRIGHT_APPLY_URL,
} from '../../../api/swanApi';
import { mapJobrightItemToResultData } from '../../../api/jobrightMapper';

const PAGE_SIZE = 10;
const PAGE_DELAY_MS = 800;
const MAX_RECOVERY_ATTEMPTS = 6;
const FEED_REFRESH_COOLDOWN_MS = 60_000;
const MAX_EMPTY_FEED_CYCLES = 3;

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
	const [progress, setProgress] = useState(0);
	const [scrapFlag, setScrapFlag] = useState(false);
	const [recoveryStatus, setRecoveryStatus] = useState('');
	const [lastJobAt, setLastJobAt] = useState(null);
	const [stats, setStats] = useState({
		saved: 0,
		duplicate: 0,
		blocked: 0,
		pages: 0,
		errors: 0,
		feedCycles: 0,
	});
	const [positionDisplay, setPositionDisplay] = useState(0);

	const { addListener, removeListener } = useRuntime();
	const api = useApi(import.meta.env.VITE_API_URL);
	const notification = useNotification();
	const scrapFlagRef = useRef(false);
	const recoveryAttemptRef = useRef(0);
	const recoveringRef = useRef(false);
	const positionRef = useRef(0);
	const firstPageRef = useRef(true);
	const emptyFeedCyclesRef = useRef(0);
	const cycleSavedAtStartRef = useRef(0);
	const savedCountRef = useRef(0);

	scrapFlagRef.current = scrapFlag;

	const notifyFailure = useCallback((err, fallback) => {
		notification.fail(err, { key: 'scrap-failure' });
		if (fallback) console.error(fallback, err);
	}, [notification]);

	const stopScraping = useCallback(async (reason) => {
		scrapFlagRef.current = false;
		setScrapFlag(false);
		setProgress(0);
		recoveringRef.current = false;
		try {
			await unbindScraperTab();
		} catch {
			/* ignore */
		}
		if (reason) {
			notification.fail(new Error(reason), { key: 'scrap-stop' });
		}
	}, [notification]);

	const handleRecovery = useCallback(async (err) => {
		if (recoveringRef.current) return { skipped: true };
		if (!scrapFlagRef.current) return { stopped: true };

		const attempt = recoveryAttemptRef.current;
		if (attempt >= MAX_RECOVERY_ATTEMPTS) {
			await stopScraping(
				`Stopped after ${MAX_RECOVERY_ATTEMPTS} recovery attempts. `
				+ 'Check Athens-server is running and Jobright tab is logged in.',
			);
			return { stopped: true };
		}

		recoveringRef.current = true;
		recoveryAttemptRef.current += 1;
		const delayMs = getBackoffDelay(attempt);
		setRecoveryStatus(`Recovering (attempt ${attempt + 1}/${MAX_RECOVERY_ATTEMPTS})… ${delayMs / 1000}s`);
		try {
			await waitMs(delayMs);
			if (!scrapFlagRef.current) return { stopped: true };
			await recoverScraper({ reason: err?.message || 'network' });
			setRecoveryStatus('');
			return { ok: true };
		} finally {
			recoveringRef.current = false;
		}
	}, [stopScraping]);

	const handleBackendRestart = useCallback(async (payload) => {
		if (!scrapFlagRef.current) return;
		if (recoveringRef.current) return;
		const reason = payload?.reason || 'backend_restart';
		setRecoveryStatus(`Backend requested restart (${reason})…`);
		try {
			const result = await handleRecovery(new Error(reason));
			if (result?.stopped) return;
			setRecoveryStatus('');
		} catch (err) {
			notifyFailure(err, 'Backend restart recovery failed');
			await stopScraping(err?.message || 'Recovery failed');
		}
	}, [handleRecovery, notifyFailure, stopScraping]);

	const { socketId, status: socketStatus } = useScraperSocket({
		scraping: scrapFlag,
		lastJobAt,
		onRestart: handleBackendRestart,
	});

	useEffect(() => {
		const listener = (message) => {
			if (message?.action === 'scraper:tab-closed' && scrapFlagRef.current) {
				setRecoveryStatus('Jobright tab closed — recovering…');
				handleRecovery(new Error('tab_closed'))
					.then((result) => {
						if (!result?.stopped) setRecoveryStatus('');
					})
					.catch((err) => notifyFailure(err, 'Tab closed recovery failed'));
			}
		};
		addListener(listener);
		return () => removeListener(listener);
	}, [addListener, removeListener, notifyFailure, handleRecovery]);

	const refreshFeedAndContinue = useCallback(async () => {
		setRecoveryStatus(
			`Feed ended — refreshing Jobright in ${FEED_REFRESH_COOLDOWN_MS / 1000}s…`,
		);
		await waitMs(FEED_REFRESH_COOLDOWN_MS);
		if (!scrapFlagRef.current) return { stopped: true };

		setRecoveryStatus('Navigating Jobright recommend…');
		const nav = await navigateScraperTab(SCRAPER_RESTART_URL);
		if (!nav?.success) {
			throw new Error(nav?.error || 'Failed to navigate Jobright tab for feed refresh');
		}

		positionRef.current = 0;
		setPositionDisplay(0);
		firstPageRef.current = true;
		setStats((s) => ({ ...s, feedCycles: s.feedCycles + 1 }));
		setRecoveryStatus('Feed refreshed — continuing scrape…');
		await waitMs(1500);
		if (!scrapFlagRef.current) return { stopped: true };
		setRecoveryStatus('');
		return { ok: true };
	}, []);

	const processPage = useCallback(async () => {
		const refresh = firstPageRef.current;
		const url = buildListJobsUrl({
			refresh,
			position: positionRef.current,
			count: PAGE_SIZE,
		});
		setProgress(20);

		const raw = await swanFetch({ url, method: 'GET' });
		const interpreted = interpretSwanListResponse(raw);

		if (!interpreted.ok) {
			const err = new Error(interpreted.error || 'Jobright list failed');
			err.sessionDead = interpreted.sessionDead;
			err.retryable = interpreted.retryable;
			err.transient = interpreted.transient;
			throw err;
		}

		firstPageRef.current = false;
		const jobs = interpreted.jobs;
		if (!jobs.length) {
			return { done: true, pageSaved: 0 };
		}

		setProgress(40);
		let pageSaved = 0;

		for (let i = 0; i < jobs.length; i += 1) {
			if (!scrapFlagRef.current) {
				throw new Error('Scraping stopped');
			}

			const item = jobs[i];
			const { resultData, jobrightJobId } = mapJobrightItemToResultData(item);
			if (!resultData.title) {
				setStats((s) => ({ ...s, errors: s.errors + 1 }));
				continue;
			}

			setProgress(40 + Math.round(((i + 1) / jobs.length) * 40));

			try {
				const res = await api.post('/jobs', resultData);
				const reason = String(res?.reason || '').toLowerCase();

				if (res?.created === true) {
					pageSaved += 1;
					savedCountRef.current += 1;
					setStats((s) => ({ ...s, saved: s.saved + 1 }));
					setLastJobAt(new Date().toISOString());
					recoveryAttemptRef.current = 0;
				} else if (reason.includes('already exists') || reason.includes('duplicate')) {
					setStats((s) => ({ ...s, duplicate: s.duplicate + 1 }));
					setLastJobAt(new Date().toISOString());
				} else if (reason.includes('blocked by rule')) {
					setStats((s) => ({ ...s, blocked: s.blocked + 1 }));
					setLastJobAt(new Date().toISOString());
				} else if (res?.success === false) {
					setStats((s) => ({ ...s, errors: s.errors + 1 }));
				} else {
					setLastJobAt(new Date().toISOString());
				}

				if (jobrightJobId) {
					const applyRaw = await swanFetch({
						url: JOBRIGHT_APPLY_URL,
						method: 'POST',
						body: { jobId: jobrightJobId, source: 0 },
					});
					const applyResult = interpretSwanApplyResponse(applyRaw);
					if (!applyResult.ok) {
						console.warn('swan/job/apply failed', applyResult.error);
					}
				}
			} catch (err) {
				setStats((s) => ({ ...s, errors: s.errors + 1 }));
				if (isNetworkError(err)) throw err;
				console.error('Failed to save job', err);
			}
		}

		setProgress(100);
		positionRef.current += jobs.length;
		setPositionDisplay(positionRef.current);
		setStats((s) => ({ ...s, pages: s.pages + 1 }));
		return { done: false, pageSaved };
	}, [api]);

	useEffect(() => {
		let active = true;

		const run = async () => {
			cycleSavedAtStartRef.current = savedCountRef.current;

			while (active && scrapFlagRef.current) {
				try {
					const result = await processPage();
					if (result.done) {
						const savedThisCycle = savedCountRef.current - cycleSavedAtStartRef.current;
						const stagnant = savedThisCycle <= 0;

						if (stagnant) {
							emptyFeedCyclesRef.current += 1;
						} else {
							emptyFeedCyclesRef.current = 0;
						}

						if (emptyFeedCyclesRef.current >= MAX_EMPTY_FEED_CYCLES) {
							await stopScraping(
								`Stopped after ${MAX_EMPTY_FEED_CYCLES} empty feed cycles with no new jobs.`,
							);
							notification.success('No new jobs after repeated feed refresh');
							break;
						}

						try {
							const refreshResult = await refreshFeedAndContinue();
							if (refreshResult?.stopped || !scrapFlagRef.current) break;
							cycleSavedAtStartRef.current = savedCountRef.current;
						} catch (refreshErr) {
							notifyFailure(refreshErr, 'Feed refresh failed');
							await stopScraping(refreshErr?.message || 'Feed refresh failed');
							break;
						}
						continue;
					}
					if (!scrapFlagRef.current) break;
					await waitMs(PAGE_DELAY_MS);
				} catch (err) {
					if (!active || !scrapFlagRef.current) break;

					if (err?.sessionDead) {
						await stopScraping(err.message);
						break;
					}

					if (isNetworkError(err) || err?.retryable) {
						notifyFailure(err, 'Transient scrape error');
						try {
							const recovery = await handleRecovery(err);
							if (recovery?.stopped) break;
						} catch (recoveryErr) {
							notifyFailure(recoveryErr, 'Recovery failed after network error');
							await stopScraping(recoveryErr?.message || 'Recovery failed');
							break;
						}
						continue;
					}

					notifyFailure(err, 'Scrape error');
					await stopScraping(err?.message || 'Scrape error');
					break;
				}
			}
		};

		if (scrapFlag) {
			run();
		}

		return () => {
			active = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- loop starts when scrapFlag turns on
	}, [scrapFlag]);

	const onStart = async () => {
		setStats({ saved: 0, duplicate: 0, blocked: 0, pages: 0, errors: 0, feedCycles: 0 });
		positionRef.current = 0;
		setPositionDisplay(0);
		firstPageRef.current = true;
		emptyFeedCyclesRef.current = 0;
		cycleSavedAtStartRef.current = 0;
		savedCountRef.current = 0;
		recoveryAttemptRef.current = 0;
		recoveringRef.current = false;
		setProgress(0);
		setRecoveryStatus('Binding Jobright tab…');
		try {
			const bind = await bindScraperTab();
			if (!bind?.success) {
				throw new Error(bind?.error || 'Failed to bind Jobright tab');
			}
			setRecoveryStatus('');
			setScrapFlag(true);
			notification.success('API scrape started');
		} catch (err) {
			setRecoveryStatus('');
			notifyFailure(err, 'Failed to start scrape');
		}
	};

	const onStop = async () => {
		await stopScraping();
		notification.success('Scrape stopped');
	};

	return (
		<Stack spacing={2}>
			<Paper variant="outlined" sx={{ p: 2 }}>
				<Stack spacing={1.5}>
					<Typography variant="subtitle1" fontWeight={600}>
						Jobright API Scraper
					</Typography>
					<Typography variant="body2" color="text.secondary">
						Backend: {import.meta.env.VITE_API_URL || '(unset)'} · Socket: {socketStatus || 'offline'}
					</Typography>
					<Stack direction="row" spacing={1} alignItems="center">
						{!scrapFlag ? (
							<Button variant="contained" startIcon={<PlayArrow />} onClick={onStart}>
								Start
							</Button>
						) : (
							<Button variant="outlined" color="error" startIcon={<Stop />} onClick={onStop}>
								Stop
							</Button>
						)}
						{scrapFlag && <CircularProgressWithLabel value={progress || 10} />}
					</Stack>
					{recoveryStatus ? (
						<Typography variant="body2" color="warning.main">{recoveryStatus}</Typography>
					) : null}
					{socketId ? (
						<Typography variant="caption" color="text.secondary">
							Socket id: {socketId}
						</Typography>
					) : (
						<Typography variant="caption" color="warning.main">
							Socket disconnected — start Athens-server on the API host
						</Typography>
					)}
					<Divider />
					<Typography variant="body2">
						Pages {stats.pages} · Saved {stats.saved} · Duplicates {stats.duplicate} · Blocked{' '}
						{stats.blocked} · Errors {stats.errors} · Position {positionDisplay} · Feed cycles{' '}
						{stats.feedCycles}
					</Typography>
				</Stack>
			</Paper>
		</Stack>
	);
};

export default ScrapComponent;
