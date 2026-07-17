import React from "react";
import { Loader2 } from "lucide-react";
import { MailListRow } from "./MailListRow";
import type { MailThread } from "../../../types";

interface DateGroup {
  section: string;
  label: string;
  threads: MailThread[];
}

interface ThreadListProps {
  grouped: DateGroup[];
  loading: boolean;
  syncing?: boolean;
  threadsLength: number;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, checked: boolean) => void;
  onOpenThread: (id: string) => void;
  onStar: (id: string) => void;
  onArchive: (id: string) => void;
  onTrash: (id: string) => void;
  onMarkUnread: (id: string, unread: boolean) => void;
  onDropLabel: (threadId: string, labelPath: string) => void;
}

/** Approximate pixel heights for virtual scrolling calculations. */
const HEADER_HEIGHT = 28;
const ROW_HEIGHT = 64;

/**
 * Renders thread groups with virtual scrolling when the list is large.
 * For small lists (< 30 threads), renders everything directly since
 * virtualization overhead isn't worth it.
 */
export function ThreadList({
  grouped,
  loading,
  syncing = false,
  threadsLength,
  selectedIds,
  onToggleSelect,
  onOpenThread,
  onStar,
  onArchive,
  onTrash,
  onMarkUnread,
  onDropLabel,
}: ThreadListProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [containerHeight, setContainerHeight] = React.useState(600);

  // When threads are few, render everything — simpler and avoids virtualization overhead
  const useVirtual = threadsLength > 30;

  // Compute total height and flat item list for the virtualizer
  const { totalHeight, flatItems } = React.useMemo(() => {
    const items: Array<{ kind: "header"; label: string } | { kind: "thread"; thread: MailThread }> = [];
    for (const group of grouped) {
      if (group.label) {
        items.push({ kind: "header", label: group.label });
      }
      for (const t of group.threads) {
        items.push({ kind: "thread", thread: t });
      }
    }
    let height = 0;
    for (const item of items) {
      height += item.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT;
    }
    return { totalHeight: height, flatItems: items };
  }, [grouped]);

  // Recalculate container height on resize
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Attach scroll listener
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || !useVirtual) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [useVirtual]);

  const renderRow = (t: MailThread) => (
    <MailListRow
      key={t.id}
      thread={t}
      selected={selectedIds.has(t.id)}
      onSelect={() => onOpenThread(t.id)}
      onToggleSelect={(checked) => onToggleSelect(t.id, checked)}
      onStar={() => onStar(t.id)}
      onArchive={() => onArchive(t.id)}
      onTrash={() => onTrash(t.id)}
      onMarkUnread={() => onMarkUnread(t.id, true)}
      onDropLabel={(labelPath) => onDropLabel(t.id, labelPath)}
    />
  );

  // Loading state
  if (loading && threadsLength === 0) {
    return (
      <div className="flex-1 overflow-y-auto subtle-scroll min-h-0">
        <div className="p-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading mail…
        </div>
      </div>
    );
  }

  const syncOverlay = syncing && threadsLength > 0 && (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-[1px]">
      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
    </div>
  );

  // Empty state
  if (threadsLength === 0) {
    return (
      <div className="relative flex-1 overflow-y-auto subtle-scroll min-h-0">
        {syncOverlay}
        <p className="p-6 text-sm text-muted-foreground text-center">No messages</p>
      </div>
    );
  }

  // Small list — render everything
  if (!useVirtual) {
    return (
      <div className="relative flex-1 overflow-y-auto subtle-scroll min-h-0">
        {syncOverlay}
        {grouped.map((group) => (
          <div key={group.section}>
            {group.label && (
              <div className="px-4 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/30 border-b border-border/40">
                {group.label}
              </div>
            )}
            {group.threads.map((t) => renderRow(t))}
          </div>
        ))}
      </div>
    );
  }

  // Large list — virtual scrolling
  const OVERSCAN = 5;
  const viewportTop = scrollTop;
  const viewportBottom = scrollTop + containerHeight;

  // Find visible range by walking items and accumulating heights
  let accY = 0;
  const visible: Array<{ item: (typeof flatItems)[number]; y: number; height: number }> = [];

  for (let i = 0; i < flatItems.length; i++) {
    const h = flatItems[i].kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT;
    const itemTop = accY;
    const itemBottom = accY + h;
    accY += h;

    if (itemBottom < viewportTop - OVERSCAN * ROW_HEIGHT) continue;
    if (itemTop > viewportBottom + OVERSCAN * ROW_HEIGHT) {
      break;
    }
    visible.push({ item: flatItems[i], y: itemTop, height: h });
  }

  return (
    <div ref={containerRef} className="relative flex-1 overflow-y-auto subtle-scroll min-h-0">
      {syncOverlay}
      <div style={{ height: totalHeight, position: "relative" }}>
        {visible.map(({ item, y, height }) => (
          <div
            key={item.kind === "header" ? `h-${item.label}` : item.thread.id}
            style={{ position: "absolute", top: y, left: 0, right: 0, height }}
          >
            {item.kind === "header" ? (
              <div className="px-4 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide bg-muted/30 border-b border-border/40">
                {item.label}
              </div>
            ) : (
              renderRow(item.thread)
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
