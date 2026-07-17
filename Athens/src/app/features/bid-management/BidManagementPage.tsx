import { useMemo, useState, type DragEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  Circle,
  Folder,
  ChevronRight,
  LayoutGrid,
  Rows3,
  ArrowLeft,
  Lock,
  GripVertical,
  Film,
  Clapperboard,
  Loader2,
} from "lucide-react";
import { Link } from "react-router";
import { PageShell } from "../../components/layout/PageShell";
import { PATHS } from "../../config/routes";
import type { BidResult, BidResultStatus, FlagLight, PeriodPreset, ViewMode } from "./types";
import {
  BID_STATUSES,
  EDITABLE_STATUSES,
  canChangeStatus,
  isEditableStatus,
  isRejectableStatus,
} from "./types";
import {
  STATUS_LABELS,
  PERIOD_LABELS,
  computeKpis,
  formatDuration,
  formatFolderShort,
  filterByPeriod,
  buildDateFolders,
  dayKeyFromIso,
} from "./lib";
import { MediaPlayerModal } from "./components/MediaPlayerModal";
import { BidDetailPane } from "./components/BidDetailPane";
import { useBidResults } from "./hooks/useBidResults";
import { useRecordingUrl } from "./hooks/useRecordingUrl";
import "./bid-management.css";

const DND_TYPE = "application/x-bid-result-id";

function FlagDot({ label, value }: { label: string; value: FlagLight }) {
  const tone = value === "green" ? "green" : value === "red" ? "red" : "muted";
  return (
    <span className={`bm-flag ${tone}`}>
      <Circle className="w-2.5 h-2.5" fill="currentColor" />
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: BidResultStatus }) {
  return <span className={`bm-status ${status}`}>{STATUS_LABELS[status]}</span>;
}

function TicketCard({
  result,
  active,
  onSelect,
  onDragStart,
}: {
  result: BidResult;
  active: boolean;
  onSelect: () => void;
  onDragStart?: (e: DragEvent, id: string) => void;
}) {
  const editable = isEditableStatus(result.status);
  const draggable = editable || result.status === "skipped";
  return (
    <div
      className={`bm-ticket ${active ? "active" : ""} ${draggable ? "draggable" : "locked"}`}
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart?.(e, result.id) : undefined}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="bm-ticket-top">
        {draggable ? (
          <GripVertical className="w-3.5 h-3.5 bm-grip" />
        ) : (
          <Lock className="w-3 h-3 bm-grip locked" />
        )}
        <span className="bm-avatar xs">{result.bidder.avatarInitials}</span>
        <span className="bm-ticket-company">{result.job.company}</span>
        {result.recording ? <Film className="w-3 h-3 bm-ticket-rec" /> : null}
      </div>
      <div className="bm-ticket-title">{result.job.title}</div>
      {(result.resubmitCount ?? 0) > 0 ||
      result.resumeMismatch ||
      result.resumeStackMatch === "mismatch" ||
      result.rejectSource ? (
        <div className="bm-ticket-badges">
          {(result.resubmitCount ?? 0) > 0 ? (
            <span className="bm-mini-badge warn">×{result.resubmitCount} resub</span>
          ) : null}
          {result.rejectSource === "skipped" ? (
            <span className="bm-mini-badge">from skip</span>
          ) : null}
          {result.resumeMismatch ? <span className="bm-mini-badge danger">name</span> : null}
          {result.resumeStackMatch === "mismatch" ? (
            <span className="bm-mini-badge danger">stack</span>
          ) : null}
        </div>
      ) : null}
      <div className="bm-ticket-foot">
        <span>{result.status === "pending" ? "Bid ready" : result.bidder.name}</span>
        <span>{formatDuration(result.durationSec)}</span>
      </div>
    </div>
  );
}

function DateFolderGrid({
  folders,
  onOpen,
  todayKey,
}: {
  folders: ReturnType<typeof buildDateFolders>;
  onOpen: (dayKey: string) => void;
  todayKey: string;
}) {
  if (folders.length === 0) {
    return <div className="bm-empty pane">No bid folders in this period</div>;
  }

  return (
    <div className="bm-folder-grid">
      {folders.map((f, i) => {
        const isToday = f.dayKey === todayKey;
        return (
          <motion.button
            key={f.dayKey}
            type="button"
            className={`bm-folder ${isToday ? "today" : ""}`}
            onClick={() => onOpen(f.dayKey)}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: Math.min(i * 0.03, 0.25), duration: 0.22 }}
          >
            <div className="bm-folder-icon">
              <Folder className="w-11 h-11" fill="currentColor" strokeWidth={1.15} />
            </div>
            <div className="bm-folder-name">
              {isToday ? "Today" : formatFolderShort(f.dayKey)}
            </div>
            <div className="bm-folder-date">{f.label}</div>
            <div className="bm-folder-count">
              {f.count} {f.count === 1 ? "bid" : "bids"}
              {f.byStatus.pending > 0
                ? ` · ${f.byStatus.pending} pending`
                : ""}
            </div>
            <div className="bm-folder-pips">
              {BID_STATUSES.filter((s) => f.byStatus[s] > 0).map((s) => (
                <span key={s} className={`bm-pip ${s}`} title={`${STATUS_LABELS[s]}: ${f.byStatus[s]}`} />
              ))}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

function KanbanBoard({
  results,
  selectedId,
  onSelect,
  onMove,
}: {
  results: BidResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, status: BidResultStatus) => void;
}) {
  const [dragOver, setDragOver] = useState<BidResultStatus | null>(null);

  const onDragStart = (e: DragEvent, id: string) => {
    e.dataTransfer.setData(DND_TYPE, id);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="bm-kanban subtle-scroll">
      {BID_STATUSES.map((status) => {
        const col = results.filter((r) => r.status === status);
        const droppable = isEditableStatus(status);
        return (
          <div
            key={status}
            className={`bm-kanban-col ${droppable || status === "rejected" ? "droppable" : "locked-col"} ${dragOver === status ? "drag-over" : ""}`}
            onDragOver={
              droppable || status === "rejected"
                ? (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOver(status);
                  }
                : undefined
            }
            onDragLeave={() => setDragOver((cur) => (cur === status ? null : cur))}
            onDrop={
              droppable || status === "rejected"
                ? (e) => {
                    e.preventDefault();
                    setDragOver(null);
                    const id = e.dataTransfer.getData(DND_TYPE);
                    if (id) onMove(id, status);
                  }
                : undefined
            }
          >
            <div className="bm-kanban-head">
              <StatusPill status={status} />
              {!droppable ? <Lock className="w-3 h-3 opacity-40" /> : null}
              <span className="bm-muted mono">{col.length}</span>
            </div>
            {status === "pending" && (
              <div className="bm-col-hint">Bid ready jobs</div>
            )}
            {status === "skipped" && (
              <div className="bm-col-hint">Expired / skipped by bidder</div>
            )}
            <div className="bm-kanban-cards">
              {col.length === 0 ? (
                <div className="bm-kanban-empty">
                  {status === "pending"
                    ? "No Bid ready jobs"
                    : status === "skipped"
                      ? "No skipped jobs"
                      : "Empty"}
                </div>
              ) : (
                col.map((r) => (
                  <TicketCard
                    key={r.id}
                    result={r}
                    active={selectedId === r.id}
                    onSelect={() => onSelect(r.id)}
                    onDragStart={onDragStart}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListBoard({
  results,
  selectedId,
  onSelect,
  onChangeStatus,
}: {
  results: BidResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChangeStatus: (id: string, status: BidResultStatus) => void;
}) {
  return (
    <div className="bm-list-board subtle-scroll">
      {results.length === 0 ? (
        <div className="bm-empty">No bids for this day</div>
      ) : (
        results.map((r, i) => {
          const editable = isEditableStatus(r.status);
          return (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.2) }}
            >
              <div className={`bm-list-row ${selectedId === r.id ? "active" : ""}`}>
                <button type="button" className="bm-list-main" onClick={() => onSelect(r.id)}>
                  <span className="bm-avatar">{r.bidder.avatarInitials}</span>
                  <div className="bm-list-copy">
                    <div className="bm-list-title">{r.job.title}</div>
                    <div className="bm-list-sub">
                      {r.job.company} · {r.status === "pending" ? "Bid ready" : r.bidder.name} · {r.job.source}
                    </div>
                  </div>
                  {!editable ? <StatusPill status={r.status} /> : null}
                  <span className="bm-list-dur">{formatDuration(r.durationSec)}</span>
                  {r.recording ? <Film className="w-3.5 h-3.5 bm-ticket-rec" /> : <span className="bm-list-spacer" />}
                  {!editable ? <Lock className="w-3 h-3 opacity-35" /> : null}
                </button>
                {editable ? (
                  <select
                    className="bm-list-status"
                    value={r.status}
                    aria-label={`Status for ${r.job.title}`}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      onChangeStatus(r.id, e.target.value as BidResultStatus);
                    }}
                  >
                    {EDITABLE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                ) : isRejectableStatus(r.status) && r.status === "skipped" ? (
                  <button
                    type="button"
                    className="bm-reject-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChangeStatus(r.id, "rejected");
                    }}
                  >
                    Reject
                  </button>
                ) : null}
              </div>
            </motion.div>
          );
        })
      )}
    </div>
  );
}

function promptRejectReason(): string | null {
  const raw = window.prompt("Reject reason (optional — leave blank to skip):", "");
  if (raw === null) return null;
  return raw.trim();
}

export function BidManagementPage() {
  const {
    results: allResults,
    stats,
    loading: resultsLoading,
    error: resultsError,
    setStatus,
  } = useBidResults();
  const [period, setPeriod] = useState<PeriodPreset>("14d");
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const moveStatus = (id: string, next: BidResultStatus) => {
    const current = allResults.find((r) => r.id === id);
    if (!current || !canChangeStatus(current.status, next)) return;
    if (next === "rejected") {
      const reason = promptRejectReason();
      if (reason === null) return;
      void setStatus(id, next, { rejectReason: reason || null });
      return;
    }
    void setStatus(id, next);
  };

  const periodResults = useMemo(() => filterByPeriod(allResults, period), [allResults, period]);
  const folders = useMemo(() => buildDateFolders(periodResults), [periodResults]);
  const todayKey = useMemo(() => dayKeyFromIso(new Date().toISOString()), []);
  const pendingCount = useMemo(
    () => allResults.filter((r) => r.status === "pending").length,
    [allResults],
  );

  const dayResults = useMemo(() => {
    if (!selectedDay) return [];
    const q = query.trim().toLowerCase();
    return periodResults
      .filter((r) => r.dayKey === selectedDay)
      .filter((r) => {
        if (!q) return true;
        return (
          r.job.title.toLowerCase().includes(q) ||
          r.job.company.toLowerCase().includes(q) ||
          r.bidder.name.toLowerCase().includes(q) ||
          r.job.source.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.pooledAt.localeCompare(a.pooledAt));
  }, [periodResults, selectedDay, query]);

  // Folder view: period KPIs. Day view: KPIs match that day's columns (ignore search filter).
  const headerKpis = useMemo(() => {
    if (!selectedDay) return computeKpis(periodResults);
    return computeKpis(periodResults.filter((r) => r.dayKey === selectedDay));
  }, [selectedDay, periodResults]);

  const selected = dayResults.find((r) => r.id === selectedId) ?? null;
  const playingResult = playing ? selected : null;
  const activeFolder = folders.find((f) => f.dayKey === selectedDay) ?? null;
  const {
    url: playingUrl,
    loading: playingUrlLoading,
    error: playingUrlError,
  } = useRecordingUrl(
    playing ? playingResult?.recording?.storagePath || null : null,
  );

  const openDay = (dayKey: string) => {
    setSelectedDay(dayKey);
    setSelectedId(null);
    setQuery("");
    setPlaying(false);
  };

  const backToFolders = () => {
    setSelectedDay(null);
    setSelectedId(null);
    setPlaying(false);
  };

  return (
    <PageShell fullWidth className="bm-page">
      <div className="bm-shell">
        <motion.header
          className="bm-hero"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <div>
            <div className="bm-brand-row">
              <Clapperboard className="w-5 h-5 bm-brand-icon" />
              <span className="bm-brand">Bid Management</span>
              <span className="bm-mock-tag">Live</span>
            </div>
            <p className="bm-hero-sub">
              Bid Ready → In-Process → Submitted (Firebase recording) · drag Reviewed / Rejected
            </p>
          </div>

          <div className="bm-hero-right">
            <div className="bm-period">
              {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={period === p ? "active" : ""}
                  onClick={() => {
                    setPeriod(p);
                    setSelectedDay(null);
                  }}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
            <div className="bm-kpis compact">
              {BID_STATUSES.map((key) => (
                <div key={key} className="bm-kpi static">
                  <span className="bm-kpi-val">{headerKpis[key]}</span>
                  <span className="bm-kpi-label">{STATUS_LABELS[key]}</span>
                </div>
              ))}
              {stats ? (
                <>
                  <div className="bm-kpi static">
                    <span className="bm-kpi-val">
                      {Math.round((stats.rejectionRate || 0) * 100)}%
                    </span>
                    <span className="bm-kpi-label">Reject rate</span>
                  </div>
                  <div className="bm-kpi static">
                    <span className="bm-kpi-val">{stats.realRejects}</span>
                    <span className="bm-kpi-label">Real rejects</span>
                  </div>
                  <div className="bm-kpi static">
                    <span className="bm-kpi-val">
                      {stats.avgBiddingDurationSec != null
                        ? formatDuration(stats.avgBiddingDurationSec)
                        : "—"}
                    </span>
                    <span className="bm-kpi-label">Avg bid time</span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </motion.header>

        {resultsError ? <div className="bm-error-banner">{resultsError}</div> : null}
        {resultsLoading ? (
          <div className="bm-info-banner">
            <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" />
            Loading live bid results…
          </div>
        ) : pendingCount === 0 && allResults.length === 0 ? (
          <div className="bm-info-banner">
            No Bid ready jobs for this profile. Mark jobs as Bid ready in{" "}
            <Link to={PATHS.jobs}>Job Search</Link>, then Apply from Bid-Monitor.
          </div>
        ) : pendingCount === 0 ? (
          <div className="bm-info-banner">
            No Pending (Bid ready) jobs right now. Mark more in{" "}
            <Link to={PATHS.jobs}>Job Search</Link> or finish In-Process tickets in Bid-Monitor.
          </div>
        ) : null}

        <div className="bm-pathbar">
          <button type="button" className="bm-crumb" onClick={backToFolders}>
            Bid folders
          </button>
          {activeFolder ? (
            <>
              <ChevronRight className="w-3.5 h-3.5 opacity-40" />
              <span className="bm-crumb current">{activeFolder.label}</span>
            </>
          ) : null}
          <span className="bm-path-meta">
            {selectedDay
              ? `${dayResults.length} tickets`
              : `${folders.length} date folders · ${periodResults.length} bids`}
          </span>
        </div>

        <AnimatePresence mode="wait">
          {!selectedDay ? (
            <motion.div
              key="folders"
              className="bm-folder-pane"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <DateFolderGrid folders={folders} onOpen={openDay} todayKey={todayKey} />
            </motion.div>
          ) : (
            <motion.div
              key={`day-${selectedDay}`}
              className="bm-day-pane"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              <div className="bm-day-toolbar">
                <button type="button" className="bm-back" onClick={backToFolders}>
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Folders
                </button>

                <div className="bm-mode-toggle">
                  <button
                    type="button"
                    className={viewMode === "kanban" ? "active" : ""}
                    onClick={() => setViewMode("kanban")}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    Kanban
                  </button>
                  <button
                    type="button"
                    className={viewMode === "list" ? "active" : ""}
                    onClick={() => setViewMode("list")}
                  >
                    <Rows3 className="w-3.5 h-3.5" />
                    List
                  </button>
                </div>

                <div className="bm-search grow">
                  <Search className="w-3.5 h-3.5" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter tickets…"
                    aria-label="Filter tickets"
                  />
                </div>
              </div>

              <div className={`bm-day-workspace ${viewMode}`}>
                <div className="bm-day-board">
                  {viewMode === "kanban" ? (
                    <KanbanBoard
                      results={dayResults}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      onMove={moveStatus}
                    />
                  ) : (
                    <ListBoard
                      results={dayResults}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      onChangeStatus={moveStatus}
                    />
                  )}
                </div>
              </div>

              <BidDetailPane
                result={selected}
                onClose={() => {
                  setSelectedId(null);
                  setPlaying(false);
                }}
                onWatch={() => setPlaying(true)}
                onChangeStatus={(id, status, options) => {
                  void setStatus(id, status, options);
                }}
                lockDismiss={playing}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <MediaPlayerModal
        open={Boolean(playing && playingResult?.recording?.storagePath)}
        title={playingResult?.job.title ?? "Recording"}
        subtitle={
          playingResult ? `${playingResult.bidder.name} · ${playingResult.job.company}` : undefined
        }
        src={playingUrl}
        loading={playingUrlLoading}
        error={playingUrlError}
        pathHint={playingResult?.recording?.storagePath}
        onClose={() => setPlaying(false)}
      />
    </PageShell>
  );
}

export default BidManagementPage;
