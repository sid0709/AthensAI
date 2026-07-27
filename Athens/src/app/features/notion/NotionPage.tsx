import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Database,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Link } from "react-router";
import { useApplier } from "@/context/applier-context";
import { PATHS } from "../../config/routes";
import {
  fetchNotionPage,
  fetchNotionStatus,
  notionResourceTitle,
  queryNotionDataSource,
  searchNotionResources,
  type NotionFile,
  type NotionIcon,
  type NotionResource,
  type NotionStatus,
} from "../../services/notionApi";
import { NotionBlockTree } from "./components/NotionBlocks";
import { NotionPropertyValue, notionPropertyText } from "./components/NotionPropertyValue";
import { cn } from "../../lib/utils";

function fileUrl(value?: NotionFile | null): string | undefined {
  return value?.file?.url || value?.external?.url;
}

function ResourceIcon({ icon, type, className }: { icon?: NotionIcon | null; type?: string; className?: string }) {
  if (icon?.type === "emoji" && icon.emoji) return <span className={cn("text-lg", className)}>{icon.emoji}</span>;
  const image = icon?.file?.url || icon?.external?.url || icon?.custom_emoji?.url;
  if (image) return <img src={image} alt="" className={cn("h-5 w-5 rounded object-cover", className)} />;
  return type === "data_source" ? <Database className={cn("h-4 w-4", className)} /> : <FileText className={cn("h-4 w-4", className)} />;
}

type ResourceTreeNode = {
  resource: NotionResource;
  children: ResourceTreeNode[];
};

function parentId(resource: NotionResource): string | null {
  const parent = resource.parent || {};
  if (parent.type === "page_id" && typeof parent.page_id === "string") return parent.page_id;
  if (parent.type === "block_id" && typeof parent.block_id === "string") return parent.block_id;
  const databaseParent = resource.database_parent;
  if (databaseParent && typeof databaseParent === "object") {
    const value = databaseParent as Record<string, unknown>;
    if (value.type === "page_id" && typeof value.page_id === "string") return value.page_id;
    if (value.type === "block_id" && typeof value.block_id === "string") return value.block_id;
  }
  return null;
}

function isDatabaseRow(resource: NotionResource): boolean {
  const type = String(resource.parent?.type || "");
  return resource.object === "page" && (type === "data_source_id" || type === "database_id");
}

function buildResourceTree(resources: NotionResource[]): ResourceTreeNode[] {
  const visible = resources.filter((resource) => !isDatabaseRow(resource) && !resource.in_trash);
  const nodes = new Map(visible.map((resource) => [resource.id, { resource, children: [] as ResourceTreeNode[] }]));
  const roots: ResourceTreeNode[] = [];
  for (const resource of visible) {
    const node = nodes.get(resource.id)!;
    const parent = parentId(resource);
    const parentNode = parent ? nodes.get(parent) : undefined;
    if (parentNode && parentNode !== node) parentNode.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function TreeResource({
  node,
  selectedId,
  onSelect,
  depth = 0,
}: {
  node: ResourceTreeNode;
  selectedId?: string;
  onSelect: (resource: NotionResource) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className={cn(
          "mb-0.5 flex items-center rounded-lg pr-2",
          selectedId === node.resource.id ? "bg-primary/10 text-primary" : "hover:bg-secondary",
        )}
        style={{ paddingLeft: `${6 + depth * 16}px` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && setExpanded((value) => !value)}
          className="flex h-8 w-6 flex-shrink-0 items-center justify-center text-muted-foreground"
          aria-label={hasChildren ? (expanded ? "Collapse" : "Expand") : undefined}
        >
          {hasChildren ? (expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
        </button>
        <button type="button" onClick={() => onSelect(node.resource)} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left">
          <ResourceIcon icon={node.resource.icon} type={node.resource.object} />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{notionResourceTitle(node.resource)}</span>
        </button>
      </div>
      {expanded && node.children.map((child) => (
        <TreeResource key={`${child.resource.object}:${child.resource.id}`} node={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  );
}

function DisconnectedState() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-foreground text-xl font-black text-background">N</div>
        <h1 className="text-xl font-bold">Connect Notion first</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Add your internal integration token and share Call Record to browse pages and populate Calendar.
        </p>
        <Link to={`${PATHS.settings}/integrations`} className="mt-5 inline-flex min-h-10 items-center rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90">
          Open integrations
        </Link>
      </div>
    </div>
  );
}

function PropertyGrid({ resource }: { resource: NotionResource }) {
  const entries = Object.entries(resource.properties || {}).filter(([, property]) => property.type !== "title");
  if (!entries.length) return null;
  return (
    <div className="mb-6 grid gap-x-8 gap-y-2 border-y border-border py-4 md:grid-cols-2">
      {entries.map(([name, property]) => (
        <div key={property.id || name} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 text-sm">
          <span className="truncate font-medium text-muted-foreground" title={name}>{name}</span>
          <div className="min-w-0 break-words"><NotionPropertyValue property={property} /></div>
        </div>
      ))}
    </div>
  );
}

function PageViewer({ applierName, resource }: { applierName: string; resource: NotionResource }) {
  const [page, setPage] = useState<NotionResource>(resource);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPage(await fetchNotionPage(applierName, resource.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load page");
    } finally {
      setLoading(false);
    }
  }, [applierName, resource.id]);

  useEffect(() => {
    setPage(resource);
    void load();
  }, [load, resource]);

  const cover = fileUrl(page.cover);
  return (
    <article className="mx-auto w-full max-w-4xl pb-24">
      {cover && <img src={cover} alt="" className="mb-8 max-h-72 w-full rounded-xl object-cover" />}
      <div className="mb-3 flex items-start gap-3">
        <ResourceIcon icon={page.icon} type="page" className="mt-1 h-8 w-8 text-3xl" />
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-4xl font-black tracking-tight text-foreground">{notionResourceTitle(page)}</h1>
          {page.last_edited_time && (
            <p className="mt-1 text-xs text-muted-foreground">
              Edited {new Date(page.last_edited_time).toLocaleString()}
            </p>
          )}
        </div>
        {page.url && (
          <a href={page.url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 flex-shrink-0 items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-bold hover:bg-secondary">
            Open <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
      <PropertyGrid resource={page} />
      {loading && <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Refreshing page…</div>}
      {error && (
        <button type="button" onClick={() => void load()} className="mb-4 inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          <RefreshCw className="h-4 w-4" /> {error}
        </button>
      )}
      <NotionBlockTree applierName={applierName} rootId={resource.id} />
    </article>
  );
}

function DataSourceViewer({
  applierName,
  resource,
  onOpenPage,
}: {
  applierName: string;
  resource: NotionResource;
  onOpenPage: (page: NotionResource) => void;
}) {
  const [rows, setRows] = useState<NotionResource[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextCursor?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const data = await queryNotionDataSource(applierName, resource.id, nextCursor);
      setRows((previous) => (nextCursor ? [...previous, ...data.results] : data.results));
      setCursor(data.next_cursor);
      setHasMore(data.has_more);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load database rows");
    } finally {
      setLoading(false);
    }
  }, [applierName, resource.id]);

  useEffect(() => {
    setRows([]);
    void load(null);
  }, [load]);

  const columns = useMemo(() => {
    const schema = Object.keys(resource.properties || {});
    if (schema.length) return schema;
    return Object.keys(rows[0]?.properties || {});
  }, [resource.properties, rows]);

  return (
    <div className="w-full pb-20">
      <div className="mb-5 flex items-start gap-3">
        <ResourceIcon icon={resource.icon} type="data_source" className="mt-1 h-8 w-8 text-3xl" />
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-black tracking-tight">{notionResourceTitle(resource)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{rows.length} loaded rows</p>
        </div>
        {resource.url && <a href={resource.url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-bold hover:bg-secondary">Open <ExternalLink className="h-4 w-4" /></a>}
      </div>
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-secondary/70">
            <tr>{columns.map((column) => <th key={column} className="min-w-40 border-b border-r border-border px-3 py-2.5 text-left font-bold last:border-r-0">{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} onClick={() => onOpenPage(row)} className="cursor-pointer hover:bg-secondary/50">
                {columns.map((column) => (
                  <td key={column} className="max-w-72 border-b border-r border-border px-3 py-2.5 align-top last:border-r-0">
                    <div className="line-clamp-3 break-words">{notionPropertyText(row.properties?.[column]) || "—"}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading rows…</div>}
        {!loading && rows.length === 0 && !error && <div className="p-8 text-center text-sm text-muted-foreground">This data source has no rows.</div>}
      </div>
      {hasMore && <button type="button" disabled={loading} onClick={() => void load(cursor)} className="mt-4 min-h-10 rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-secondary disabled:opacity-50">Load more rows</button>}
    </div>
  );
}

export function NotionPage() {
  const { applier } = useApplier();
  const [status, setStatus] = useState<NotionStatus | null>(null);
  const [query, setQuery] = useState("");
  const [resources, setResources] = useState<NotionResource[]>([]);
  const [selected, setSelected] = useState<NotionResource | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!applier?.name) return;
    let cancelled = false;
    void fetchNotionStatus(applier.name)
      .then((next) => !cancelled && setStatus(next))
      .catch((loadError) => !cancelled && setError(loadError instanceof Error ? loadError.message : "Could not load Notion"))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [applier?.name]);

  const loadResources = useCallback(async (nextCursor?: string | null) => {
    if (!applier?.name || !status?.connected) return;
    setLoading(true);
    setError(null);
    try {
      if (!query.trim() && !nextCursor) {
        const all: NotionResource[] = [];
        let next: string | null | undefined = null;
        let pages = 0;
        do {
          const data = await searchNotionResources(applier.name, "", next, 100);
          all.push(...data.results);
          next = data.has_more ? data.next_cursor : null;
          pages += 1;
        } while (next && pages < 20);
        setResources(all);
        setCursor(next || null);
        setHasMore(Boolean(next));
      } else {
        const data = await searchNotionResources(applier.name, query.trim(), nextCursor, 100);
        setResources((previous) => (nextCursor ? [...previous, ...data.results] : data.results));
        setCursor(data.next_cursor);
        setHasMore(data.has_more);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Notion pages");
    } finally {
      setLoading(false);
    }
  }, [applier?.name, query, status?.connected]);

  const resourceTree = useMemo(() => buildResourceTree(resources), [resources]);

  useEffect(() => {
    if (!status?.connected) return;
    const timeout = window.setTimeout(() => {
      setSelected(null);
      setResources([]);
      void loadResources(null);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [loadResources, status?.connected]);

  if (loading && !status) {
    return <div className="flex h-full items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /> Loading Notion…</div>;
  }
  if (!status?.connected) return <DisconnectedState />;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside className="flex w-80 flex-shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h1 className="font-bold">Notion</h1>
              <p className="text-xs text-muted-foreground">{status.bot?.workspaceName || status.bot?.name || "Connected"}</p>
            </div>
            <Link to={PATHS.calendar} className="icon-btn h-9 w-9 border border-border text-muted-foreground hover:text-foreground" title="Open Calendar"><CalendarDays className="h-4 w-4" /></Link>
          </div>
          <label className="flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-primary/30">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shared pages" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto p-2 subtle-scroll">
          {query.trim() ? resources.map((resource) => (
            <button key={`${resource.object}:${resource.id}`} type="button" onClick={() => setSelected(resource)} className={cn("mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left", selected?.id === resource.id ? "bg-primary/10 text-primary" : "hover:bg-secondary")}>
              <ResourceIcon icon={resource.icon} type={resource.object} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{notionResourceTitle(resource)}</p><p className="text-[11px] capitalize text-muted-foreground">{resource.object.replace("_", " ")}</p></div>
            </button>
          )) : resourceTree.map((node) => (
            <TreeResource key={`${node.resource.object}:${node.resource.id}`} node={node} selectedId={selected?.id} onSelect={setSelected} />
          ))}
          {loading && <div className="flex items-center justify-center gap-2 p-4 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
          {!loading && resources.length === 0 && !error && <p className="p-4 text-center text-sm text-muted-foreground">No shared pages found.</p>}
          {error && <div className="m-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>}
          {hasMore && <button type="button" disabled={loading} onClick={() => void loadResources(cursor)} className="w-full rounded-lg p-2 text-xs font-bold text-primary hover:bg-secondary">Load more</button>}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6 subtle-scroll">
        {!selected ? (
          <div className="flex min-h-full items-center justify-center text-center">
            <div className="max-w-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-secondary"><FileText className="h-5 w-5 text-muted-foreground" /></div>
              <h2 className="font-bold">Select a Notion page</h2>
              <p className="mt-1 text-sm text-muted-foreground">Choose any shared page or data source to view its live content.</p>
            </div>
          </div>
        ) : selected.object === "data_source" ? (
          <DataSourceViewer applierName={applier!.name} resource={selected} onOpenPage={setSelected} />
        ) : (
          <PageViewer applierName={applier!.name} resource={selected} />
        )}
      </main>
    </div>
  );
}
