import { useState } from "react";
import { FolderOpen, Database, ChevronRight, Search, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { FirebaseCollection, FirebaseDocumentSummary } from "../../../api/firebase";
import { isVideoFile, VideoFileCard, VideoPlayerModal } from "./VideoPlayer";

function previewFields(data: Record<string, unknown>, max = 3): string {
  const keys = Object.keys(data || {}).slice(0, max);
  if (keys.length === 0) return "—";
  return keys.join(", ") + (Object.keys(data).length > max ? "…" : "");
}

export function CollectionSidebar({
  collections,
  selectedPath,
  loading,
  filter,
  onFilter,
  onSelect,
}: {
  collections: FirebaseCollection[];
  selectedPath: string | null;
  loading: boolean;
  filter: string;
  onFilter: (v: string) => void;
  onSelect: (path: string) => void;
}) {
  const filtered = filter.trim()
    ? collections.filter((c) => c.id.toLowerCase().includes(filter.toLowerCase()) || c.path.toLowerCase().includes(filter.toLowerCase()))
    : collections;

  return (
    <aside className="fx-sidebar">
      <div className="fx-sidebar-head">
        <div className="fx-eyebrow">Collections</div>
        <div className="fx-search">
          <Search className="w-3.5 h-3.5" />
          <input
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter collections"
          />
        </div>
      </div>
      <div className="fx-sidebar-list subtle-scroll">
        {loading && (
          <div className="fx-empty inline">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading
          </div>
        )}
        {!loading && filtered.length === 0 && <div className="fx-empty">No collections</div>}
        <AnimatePresence initial={false}>
          {filtered.map((c, i) => {
            const active = selectedPath === c.path;
            return (
              <motion.button
                key={c.path}
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.2), duration: 0.2 }}
                className={`fx-col-item ${active ? "active" : ""}`}
                onClick={() => onSelect(c.path)}
              >
                <Database className="w-3.5 h-3.5 shrink-0 opacity-70" />
                <span className="fx-col-name">{c.id}</span>
                {c.documentCount != null && <span className="fx-count">{c.documentCount}</span>}
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </aside>
  );
}

export function DocumentTable({
  documents,
  selectedId,
  loading,
  filter,
  onFilter,
  onSelect,
  hasMore,
  onLoadMore,
  rawCount,
}: {
  documents: FirebaseDocumentSummary[];
  selectedId: string | null;
  loading: boolean;
  filter: string;
  onFilter: (v: string) => void;
  onSelect: (doc: FirebaseDocumentSummary) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  rawCount: number;
}) {
  return (
    <section className="fx-table-pane">
      <div className="fx-table-toolbar">
        <div className="fx-search grow">
          <Search className="w-3.5 h-3.5" />
          <input
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            placeholder="Filter documents by id or field…"
            aria-label="Filter documents"
          />
        </div>
        <span className="fx-meta">
          {documents.length}
          {filter ? ` / ${rawCount}` : ""} docs
        </span>
      </div>
      <div className="fx-table-scroll subtle-scroll">
        <table className="fx-table">
          <thead>
            <tr>
              <th>Document ID</th>
              <th>Fields</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr
                key={doc.path}
                className={selectedId === doc.id ? "active" : ""}
                onClick={() => onSelect(doc)}
              >
                <td className="mono">{doc.id}</td>
                <td className="muted">{doc.fieldCount} · {previewFields(doc.data)}</td>
                <td className="muted">
                  {doc.updateTime ? new Date(doc.updateTime).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && (
          <div className="fx-empty inline">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading documents…
          </div>
        )}
        {!loading && documents.length === 0 && <div className="fx-empty">Select a collection or adjust filters</div>}
        {hasMore && (
          <div className="fx-load-more">
            <button type="button" className="fx-ghost-btn" onClick={onLoadMore} disabled={loading}>
              Load more
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function StorageBrowser({
  bucket,
  prefix,
  folders,
  files,
  loading,
  error,
  hasMore,
  onOpenFolder,
  onNavigatePrefix,
  onLoadMore,
}: {
  bucket: string | null;
  prefix: string;
  folders: { name: string; prefix: string }[];
  files: { name: string; fullPath: string; size: number; contentType: string | null; updated: string | null }[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  onOpenFolder: (prefix: string) => void;
  onNavigatePrefix: (prefix: string) => void;
  onLoadMore: () => void;
}) {
  const crumbs = prefix ? prefix.replace(/\/$/, "").split("/") : [];
  const [playing, setPlaying] = useState<(typeof files)[number] | null>(null);

  return (
    <div className="fx-storage">
      <div className="fx-breadcrumbs">
        <button type="button" className="fx-crumb" onClick={() => onNavigatePrefix("")}>
          {bucket || "bucket"}
        </button>
        {crumbs.map((part, i) => {
          const p = crumbs.slice(0, i + 1).join("/") + "/";
          return (
            <span key={p} className="fx-crumb-wrap">
              <ChevronRight className="w-3.5 h-3.5 opacity-40" />
              <button type="button" className="fx-crumb" onClick={() => onNavigatePrefix(p)}>
                {part}
              </button>
            </span>
          );
        })}
      </div>
      {error && <div className="fx-error">{error}</div>}
      <div className="fx-storage-grid subtle-scroll">
        {folders.map((f) => (
          <button key={f.prefix} type="button" className="fx-storage-card folder" onClick={() => onOpenFolder(f.prefix)}>
            <FolderOpen className="w-5 h-5" />
            <span>{f.name}</span>
          </button>
        ))}
        {files.map((f) =>
          isVideoFile(f.name, f.contentType) ? (
            <VideoFileCard key={f.fullPath} file={f} onPlay={() => setPlaying(f)} />
          ) : (
            <div key={f.fullPath} className="fx-storage-card file">
              <div className="fx-file-name">{f.name}</div>
              <div className="fx-file-meta">
                {f.contentType || "file"} · {(f.size / 1024).toFixed(1)} KB
              </div>
            </div>
          ),
        )}
        {loading && (
          <div className="fx-empty inline">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}
        {!loading && folders.length === 0 && files.length === 0 && <div className="fx-empty">Empty folder</div>}
      </div>
      {hasMore && (
        <div className="fx-load-more">
          <button type="button" className="fx-ghost-btn" onClick={onLoadMore}>
            Load more
          </button>
        </div>
      )}

      <VideoPlayerModal open={Boolean(playing)} file={playing} onClose={() => setPlaying(null)} />
    </div>
  );
}
