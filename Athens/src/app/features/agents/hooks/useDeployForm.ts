import { useEffect, useState } from "react";
import { useApplier } from "@/context/applier-context";
import { fetchAgentModels, fetchJobSources, fetchCandidateJobs, type JobCandidate } from "../../../services/agentApi";
import type { DeployOptions, ModelOption, SourceOption } from "../../../types/agent";

export function useDeployForm(
  onDeploy: (opts: DeployOptions) => Promise<void> | void,
  opts?: { asNewSession?: boolean },
) {
  const { applier, applierReady } = useApplier();
  const profileId = applier?._id != null ? String(applier._id) : "";
  const asNewSession = Boolean(opts?.asNewSession);

  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState("");
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [source, setSource] = useState("");
  const [titleQuery, setTitleQuery] = useState("");
  const [postedFrom, setPostedFrom] = useState("");
  const [postedTo, setPostedTo] = useState("");
  const [fetched, setFetched] = useState<JobCandidate[]>([]);
  const [queue, setQueue] = useState<JobCandidate[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  // Debounce the free-text title filter so we don't refetch on every keystroke.
  const [debouncedTitle, setDebouncedTitle] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTitle(titleQuery.trim()), 350);
    return () => clearTimeout(timer);
  }, [titleQuery]);

  useEffect(() => {
    if (!applierReady || !profileId) {
      setModels([]);
      setModel("");
      return;
    }
    setLoadingMeta(true);
    fetchAgentModels(profileId)
      .then((modelList) => {
        setModels(modelList);
        setModel((prev) => (prev && modelList.some((m) => m.id === prev) ? prev : modelList[0]?.id || ""));
      })
      .catch((e) => setErr(String((e as Error)?.message || e)))
      .finally(() => setLoadingMeta(false));
  }, [profileId, applierReady]);

  useEffect(() => {
    if (!profileId) {
      setSources([]);
      setSource("");
      return;
    }
    fetchJobSources(profileId)
      .then((list) => {
        setSources(list);
        setSource((prev) => (prev && list.some((s) => s.title === prev) ? prev : list[0]?.title || ""));
      })
      .catch(() => setSources([]));
  }, [profileId]);

  const applierName = applier?.name || "";
  // Fetch when a source is chosen OR any filter is set — so title/date filters
  // can stand on their own across all sources without picking a source first.
  const hasFilter = Boolean(source || debouncedTitle || postedFrom || postedTo);
  useEffect(() => {
    if (!applierName || !hasFilter) {
      setFetched([]);
      setLoadingJobs(false);
      return;
    }
    let cancelled = false;
    setLoadingJobs(true);
    // Clear stale candidates immediately so the list doesn't keep showing the
    // previous source/filter results while the next request is in flight.
    setFetched([]);
    fetchCandidateJobs(applierName, source, 200, {
      titleQuery: debouncedTitle,
      postedFrom,
      postedTo,
    })
      .then((jobs) => {
        if (!cancelled) setFetched(jobs);
      })
      .catch(() => {
        if (!cancelled) setFetched([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingJobs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applierName, source, debouncedTitle, postedFrom, postedTo, hasFilter]);

  const queuedIds = new Set(queue.map((j) => j.id));
  const candidates = fetched.filter((j) => !queuedIds.has(j.id));

  const addToQueue = (job: JobCandidate) => setQueue((q) => (q.some((x) => x.id === job.id) ? q : [...q, job]));
  const removeFromQueue = (id: string) => setQueue((q) => q.filter((x) => x.id !== id));
  const addAll = () => setQueue((q) => [...q, ...candidates]);
  const clearQueue = () => setQueue([]);

  /** Manually queue a pasted job URL (no job source needed). Returns false on a bad URL. */
  const addUrlToQueue = (rawUrl: string): boolean => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return false;
    let normalized: string;
    let host: string;
    try {
      const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
      normalized = u.toString();
      host = u.hostname.replace(/^www\./, "");
    } catch {
      setErr("Enter a valid job URL");
      return false;
    }
    setErr("");
    setQueue((q) =>
      q.some((x) => x.url === normalized)
        ? q
        : [...q, { id: `manual:${normalized}`, title: host, company: "Manual link", url: normalized, source: "manual" } as JobCandidate],
    );
    return true;
  };

  const selectedSource = sources.find((s) => s.title === source);
  const posted = selectedSource?.posted ?? 0;
  // A new session can start empty (queue jobs into it later); queuing into the
  // active session still requires at least one job.
  const valid = !!profileId && (queue.length > 0 || asNewSession);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setErr("Add at least one job to the queue.");
      return;
    }
    setErr("");
    setLoading(true);
    const autoLabel = source || (debouncedTitle ? `"${debouncedTitle}"` : "Manual");
    const sessionName = name.trim() || `${autoLabel} · ${new Date().toLocaleDateString()}`;
    try {
      await onDeploy({
        name: sessionName,
        profileId,
        model: model || "avalon",
        source,
        jobIds: queue.map((j) => j.id),
        jobs: queue.map((j) => ({
          id: j.id,
          title: j.title,
          company: j.company,
          url: j.url,
          source: j.source,
        })),
        ...(asNewSession ? { createNewSession: true } : {}),
      });
    } catch (e: unknown) {
      setErr(String(e instanceof Error ? e.message : e));
      setLoading(false);
    }
  }

  return {
    name,
    setName,
    asNewSession,
    loading,
    err,
    profileName: applier?.name || "",
    models,
    model,
    setModel,
    loadingMeta,
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
    posted,
    candidates,
    queue,
    loadingJobs,
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
