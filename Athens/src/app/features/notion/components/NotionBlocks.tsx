import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ExternalLink, FileText, Loader2, RefreshCw } from "lucide-react";
import { cn } from "../../../lib/utils";
import {
  fetchNotionBlockChildren,
  notionPlainText,
  type NotionBlock,
  type NotionFile,
  type NotionRichText,
} from "../../../services/notionApi";

type BlockPayload = Record<string, unknown> & {
  rich_text?: NotionRichText[];
  caption?: NotionRichText[];
  language?: string;
  checked?: boolean;
  color?: string;
  cells?: NotionRichText[][];
  expression?: string;
  url?: string;
  external?: { url?: string };
  file?: { url?: string; expiry_time?: string };
  icon?: { emoji?: string };
};

function payload(block: NotionBlock): BlockPayload {
  const value = block[block.type];
  return value && typeof value === "object" ? (value as BlockPayload) : {};
}

function notionColor(color?: string): CSSProperties | undefined {
  const text: Record<string, string> = {
    gray: "#787774",
    brown: "#9f6b53",
    orange: "#d9730d",
    yellow: "#cb912f",
    green: "#448361",
    blue: "#337ea9",
    purple: "#9065b0",
    pink: "#c14c8a",
    red: "#d44c47",
  };
  const backgrounds: Record<string, string> = {
    gray_background: "rgba(120,119,116,.15)",
    brown_background: "rgba(159,107,83,.15)",
    orange_background: "rgba(217,115,13,.15)",
    yellow_background: "rgba(203,145,47,.18)",
    green_background: "rgba(68,131,97,.15)",
    blue_background: "rgba(51,126,169,.15)",
    purple_background: "rgba(144,101,176,.15)",
    pink_background: "rgba(193,76,138,.15)",
    red_background: "rgba(212,76,71,.15)",
  };
  if (!color || color === "default") return undefined;
  return color.endsWith("_background")
    ? { backgroundColor: backgrounds[color] }
    : { color: text[color] };
}

export function RichText({ value }: { value?: NotionRichText[] }) {
  if (!value?.length) return null;
  return value.map((part, index) => {
    const annotations = part.annotations || {};
    const content = part.plain_text ?? part.text?.content ?? part.equation?.expression ?? "";
    const style: CSSProperties = {
      ...notionColor(annotations.color),
      fontWeight: annotations.bold ? 700 : undefined,
      fontStyle: annotations.italic ? "italic" : undefined,
      textDecoration: [annotations.strikethrough ? "line-through" : "", annotations.underline ? "underline" : ""]
        .filter(Boolean)
        .join(" ") || undefined,
    };
    const child = annotations.code ? (
      <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[.9em]" style={style}>{content}</code>
    ) : (
      <span style={style}>{content}</span>
    );
    const href = part.href || part.text?.link?.url;
    return href ? (
      <a key={`${content}-${index}`} href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
        {child}
      </a>
    ) : (
      <span key={`${content}-${index}`}>{child}</span>
    );
  });
}

function fileUrl(value: BlockPayload | NotionFile): string | undefined {
  return value.file?.url || value.external?.url;
}

function Caption({ value }: { value?: NotionRichText[] }) {
  if (!value?.length) return null;
  return <figcaption className="mt-1 text-xs text-muted-foreground"><RichText value={value} /></figcaption>;
}

function useBlockChildren(applierName: string, blockId: string, enabled = true) {
  const [blocks, setBlocks] = useState<NotionBlock[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextCursor?: string | null) => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchNotionBlockChildren(applierName, blockId, nextCursor);
      setBlocks((previous) => (nextCursor ? [...previous, ...data.results] : data.results));
      setCursor(data.next_cursor);
      setHasMore(data.has_more);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load page content");
    } finally {
      setLoading(false);
    }
  }, [applierName, blockId, enabled]);

  useEffect(() => {
    setBlocks([]);
    setCursor(null);
    if (enabled) void load(null);
  }, [enabled, load]);

  return { blocks, cursor, hasMore, loading, error, load };
}

function Children({ applierName, blockId, depth }: { applierName: string; blockId: string; depth: number }) {
  const state = useBlockChildren(applierName, blockId);
  if (state.loading && state.blocks.length === 0) {
    return <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading content…</div>;
  }
  if (state.error) {
    return (
      <button type="button" onClick={() => void state.load(null)} className="my-2 inline-flex items-center gap-1.5 text-xs font-semibold text-red-600">
        <RefreshCw className="h-3.5 w-3.5" /> {state.error}
      </button>
    );
  }
  return (
    <div className={cn("space-y-1", depth > 0 && "ml-5 border-l border-border/70 pl-4")}>
      {state.blocks.map((block) => <BlockNode key={block.id} block={block} applierName={applierName} depth={depth} />)}
      {state.hasMore && (
        <button type="button" disabled={state.loading} onClick={() => void state.load(state.cursor)} className="my-2 text-xs font-bold text-primary hover:underline">
          {state.loading ? "Loading…" : "Load more blocks"}
        </button>
      )}
    </div>
  );
}

function TableBlock({ block, applierName, depth }: { block: NotionBlock; applierName: string; depth: number }) {
  const state = useBlockChildren(applierName, block.id);
  return (
    <div className="my-4 overflow-x-auto rounded-lg border border-border">
      {state.loading && state.blocks.length === 0 ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading table…</div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <tbody>
            {state.blocks.map((row, rowIndex) => {
              const cells = payload(row).cells || [];
              return (
                <tr key={row.id} className={rowIndex === 0 ? "bg-secondary/60 font-semibold" : ""}>
                  {cells.map((cell, cellIndex) => (
                    <td key={cellIndex} className="min-w-32 border-b border-r border-border px-3 py-2 align-top last:border-r-0">
                      <RichText value={cell} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {state.error && <p className="p-3 text-xs text-red-600">{state.error}</p>}
      {state.hasMore && (
        <button type="button" onClick={() => void state.load(state.cursor)} className="p-3 text-xs font-bold text-primary">Load more rows</button>
      )}
    </div>
  );
}

function MediaBlock({ block }: { block: NotionBlock }) {
  const data = payload(block);
  const url = fileUrl(data);
  if (!url) return <Unsupported block={block} />;
  if (block.type === "image") {
    return <figure className="my-4"><img src={url} alt={notionPlainText(data.caption) || "Notion image"} className="max-h-[70vh] max-w-full rounded-lg border border-border object-contain" /><Caption value={data.caption} /></figure>;
  }
  if (block.type === "audio") {
    return <figure className="my-4"><audio controls src={url} className="w-full" /><Caption value={data.caption} /></figure>;
  }
  if (block.type === "video" && data.file?.url) {
    return <figure className="my-4"><video controls src={url} className="max-h-[70vh] w-full rounded-lg bg-black" /><Caption value={data.caption} /></figure>;
  }
  if (block.type === "pdf" || block.type === "video" || block.type === "embed") {
    return <figure className="my-4"><iframe src={url} title={`${block.type} content`} sandbox="allow-scripts allow-same-origin allow-popups" className="h-[520px] w-full rounded-lg border border-border bg-white" /><Caption value={data.caption} /></figure>;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="my-3 flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-secondary">
      <FileText className="h-5 w-5 text-muted-foreground" />
      <span className="flex-1 truncate text-sm font-semibold">{notionPlainText(data.caption) || data.url || "Open file"}</span>
      <ExternalLink className="h-4 w-4 text-muted-foreground" />
    </a>
  );
}

function Unsupported({ block }: { block: NotionBlock }) {
  return (
    <div className="my-2 flex items-center gap-3 rounded-lg border border-dashed border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
      <FileText className="h-4 w-4" />
      <span className="flex-1">{block.type.replace(/_/g, " ")} is not available through the Notion API.</span>
      {block.url && <a href={block.url} target="_blank" rel="noreferrer" className="font-semibold text-primary">Open in Notion</a>}
    </div>
  );
}

function withChildren(block: NotionBlock, applierName: string, depth: number, content: ReactNode) {
  return (
    <>
      {content}
      {block.has_children && depth < 20 && <Children applierName={applierName} blockId={block.id} depth={depth + 1} />}
    </>
  );
}

function BlockNode({ block, applierName, depth }: { block: NotionBlock; applierName: string; depth: number }) {
  const data = payload(block);
  const rich = <RichText value={data.rich_text} />;
  switch (block.type) {
    case "paragraph":
      return withChildren(block, applierName, depth, <p className="min-h-7 whitespace-pre-wrap py-1 leading-7" style={notionColor(data.color)}>{rich}</p>);
    case "heading_1":
      return withChildren(block, applierName, depth, <h1 className="mb-2 mt-7 text-3xl font-bold tracking-tight" style={notionColor(data.color)}>{rich}</h1>);
    case "heading_2":
      return withChildren(block, applierName, depth, <h2 className="mb-1.5 mt-6 text-2xl font-bold tracking-tight" style={notionColor(data.color)}>{rich}</h2>);
    case "heading_3":
    case "heading_4":
      return withChildren(block, applierName, depth, <h3 className="mb-1 mt-5 text-lg font-bold" style={notionColor(data.color)}>{rich}</h3>);
    case "bulleted_list_item":
      return withChildren(block, applierName, depth, <div className="flex gap-2 py-0.5 leading-7"><span>•</span><div>{rich}</div></div>);
    case "numbered_list_item":
      return withChildren(block, applierName, depth, <div className="flex gap-2 py-0.5 leading-7"><span className="text-muted-foreground">1.</span><div>{rich}</div></div>);
    case "to_do":
      return withChildren(block, applierName, depth, <label className="flex gap-2 py-1 leading-7"><input type="checkbox" checked={Boolean(data.checked)} readOnly className="mt-1.5 h-4 w-4 rounded border-border" /><span className={data.checked ? "text-muted-foreground line-through" : ""}>{rich}</span></label>);
    case "toggle":
    case "template":
      return <details className="my-1 rounded-md" open><summary className="cursor-pointer py-1 font-medium">{rich || block.type}</summary>{block.has_children && <Children applierName={applierName} blockId={block.id} depth={depth + 1} />}</details>;
    case "quote":
      return withChildren(block, applierName, depth, <blockquote className="my-3 border-l-4 border-foreground/70 py-1 pl-4 text-lg leading-7" style={notionColor(data.color)}>{rich}</blockquote>);
    case "callout":
      return withChildren(block, applierName, depth, <div className="my-3 flex gap-3 rounded-lg bg-secondary p-4" style={notionColor(data.color)}><span className="text-xl">{data.icon?.emoji || "💡"}</span><div className="min-w-0 flex-1 leading-7">{rich}</div></div>);
    case "code":
      return <figure className="my-4"><pre className="overflow-x-auto rounded-lg bg-zinc-950 p-4 text-sm leading-6 text-zinc-100"><code>{notionPlainText(data.rich_text)}</code></pre>{data.language && <figcaption className="mt-1 text-xs text-muted-foreground">{data.language}</figcaption>}</figure>;
    case "equation":
      return <div className="my-4 overflow-x-auto text-center font-serif text-lg">{data.expression || notionPlainText(data.rich_text)}</div>;
    case "divider":
      return <hr className="my-5 border-border" />;
    case "table":
      return <TableBlock block={block} applierName={applierName} depth={depth} />;
    case "column_list":
      return <div className="my-3 grid gap-5 md:grid-cols-2">{block.has_children && <Children applierName={applierName} blockId={block.id} depth={depth + 1} />}</div>;
    case "column":
    case "synced_block":
    case "meeting_notes":
      return block.has_children ? <Children applierName={applierName} blockId={block.id} depth={depth + 1} /> : <div className="py-1">{rich}</div>;
    case "image":
    case "video":
    case "audio":
    case "pdf":
    case "file":
      return <MediaBlock block={block} />;
    case "embed":
    case "bookmark":
    case "link_preview":
      return data.url ? (
        block.type === "embed"
          ? <MediaBlock block={{ ...block, embed: { ...data, external: { url: data.url } } }} />
          : <a href={data.url} target="_blank" rel="noreferrer" className="my-3 flex items-center gap-2 rounded-lg border border-border p-3 text-sm font-semibold text-primary hover:bg-secondary"><ExternalLink className="h-4 w-4" />{notionPlainText(data.caption) || data.url}</a>
      ) : <Unsupported block={block} />;
    case "child_page":
    case "child_database":
      return <div className="my-2 flex items-center gap-2 rounded-lg border border-border p-3 font-semibold"><FileText className="h-4 w-4" />{String(data.title || "Untitled")}</div>;
    case "breadcrumb":
    case "table_of_contents":
      return null;
    case "unsupported":
    default:
      return <Unsupported block={block} />;
  }
}

export function NotionBlockTree({ applierName, rootId }: { applierName: string; rootId: string }) {
  return <Children applierName={applierName} blockId={rootId} depth={0} />;
}
