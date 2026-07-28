import { useEffect, useMemo, useState } from "react";
import { useApplier } from "@/context/applier-context";
import { fetchCandidateJobs, type JobCandidate } from "../../../services/agentApi";
import type { DeployOptions, SourceOption } from "../../../types/agent";

function canonicalUrl(raw: string): { url: string; host: string } | null {
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    parsed.hash = "";
    [...parsed.searchParams.keys()].forEach((key) => {
      if (/^(utm_|gclid$|fbclid$|mc_)/i.test(key)) parsed.searchParams.delete(key);
    });
    return { url: parsed.toString(), host: parsed.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

function sameJob(left: JobCandidate, right: JobCandidate): boolean {
  if (!left.id.startsWith("manual:") && !right.id.startsWith("manual:")) return left.id === right.id;
  return canonicalUrl(left.url)?.url === canonicalUrl(right.url)?.url;
}

function appendUnique(current: JobCandidate[], additions: JobCandidate[]): JobCandidate[] {
  const next = [...current];
  for (const job of additions) if (!next.some((existing) => sameJob(existing, job))) next.push(job);
  return next;
}

export function useDeployForm(
  onDeploy: (opts: DeployOptions) => Promise<void> | void,
  opts?: { asNewSession?: boolean },
) {
  const { applier, applierReady } = useApplier();
  const profileId = applier?._id != null ? String(applier._id) : "";
  const applierName = applier?.name || "";
  const asNewSession = Boolean(opts?.asNewSession);

  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [source, setSource] = useState("");
  const [titleQuery, setTitleQuery] = useState("");
  const [postedFrom, setPostedFrom] = useState("");
  const [postedTo, setPostedTo] = useState("");
  const [fetched, setFetched] = useState<JobCandidate[]>([]);
  const [queue, setQueue] = useState<JobCandidate[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [jobError, setJobError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const [debouncedTitle, setDebouncedTitle] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTitle(titleQuery.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [titleQuery]);

  useEffect(() => setPage(1), [profileId, source, debouncedTitle, postedFrom, postedTo]);

  useEffect(() => {
    if (!applierReady || !applierName || !profileId) {
      setFetched([]);
      setSources([]);
      setLoadingJobs(false);
      return;
    }
    const controller = new AbortController();
    const firstPage = page === 1;
    setJobError("");
    if (firstPage) {
      setLoadingJobs(true);
      setFetched([]);
    } else {
      setLoadingMore(true);
    }
    fetchCandidateJobs(applierName, source, 100, {
      titleQuery: debouncedTitle,
      postedFrom,
      postedTo,
    }, { page, signal: controller.signal })
      .then((result) => {
        setFetched((current) => firstPage ? result.jobs : appendUnique(current, result.jobs));
        setSources(result.sources);
        setTotal(result.total);
        setTotalPages(result.totalPages);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setJobError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoadingJobs(false);
        setLoadingMore(false);
      });
    return () => controller.abort();
  }, [applierReady, applierName, profileId, source, debouncedTitle, postedFrom, postedTo, page, retryKey]);

  const candidates = useMemo(
    () => fetched.filter((job) => !queue.some((queued) => sameJob(job, queued))),
    [fetched, queue],
  );
  const addToQueue = (job: JobCandidate) => setQueue((current) => appendUnique(current, [job]));
  const removeFromQueue = (id: string) => setQueue((current) => current.filter((job) => job.id !== id));
  const addAll = () => setQueue((current) => appendUnique(current, candidates));
  const clearQueue = () => setQueue([]);

  const addUrlToQueue = (rawUrl: string): boolean => {
    const parsed = canonicalUrl(rawUrl);
    if (!parsed) {
      setErr("Enter a valid job URL");
      return false;
    }
    setErr("");
    const job: JobCandidate = {
      id: `manual:${parsed.url}`,
      title: parsed.host,
      company: "Unresolved job",
      url: parsed.url,
      source: "manual",
    };
    setQueue((current) => appendUnique(current, [job]));
    return true;
  };

  const hasFilter = Boolean(source || titleQuery || postedFrom || postedTo);
  const valid = Boolean(profileId && (queue.length > 0 || asNewSession));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setErr("Add at least one job to the queue.");
      return;
    }
    setErr("");
    setLoading(true);
    const autoLabel = source || (debouncedTitle ? `“${debouncedTitle}”` : "Agent session");
    try {
      await onDeploy({
        name: name.trim() || `${autoLabel} · ${new Date().toLocaleDateString()}`,
        profileId,
        model: "avalon",
        source,
        jobIds: queue.map((job) => job.id),
        jobs: queue,
        ...(asNewSession ? { createNewSession: true } : {}),
      });
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
      setLoading(false);
    }
  }

  return {
    name,
    setName,
    asNewSession,
    loading,
    err,
    profileName: applierName,
    sources,
    source,
    setSource,
    titleQuery,
    setTitleQuery,
    postedFrom,
    setPostedFrom,
    postedTo,
    setPostedTo,
    hasFilter,
    clearFilters: () => {
      setSource("");
      setTitleQuery("");
      setPostedFrom("");
      setPostedTo("");
    },
    candidates,
    loadedCount: fetched.length,
    total,
    hasMore: page < totalPages,
    queue,
    loadingJobs,
    loadingMore,
    jobError,
    retryJobs: () => setRetryKey((key) => key + 1),
    loadMore: () => setPage((current) => Math.min(totalPages, current + 1)),
    addToQueue,
    addUrlToQueue,
    removeFromQueue,
    addAll,
    clearQueue,
    valid,
    handleSubmit,
    applierReady,
  };
}
