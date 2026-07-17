import React from "react";
import { Building, Eye, MoreHorizontal, Plus } from "lucide-react";
import { Av, Score } from "../../../components/ui";
import { cn } from "../../../lib/utils";
import type { Application } from "../../../types";

type ApplicationCardProps = {
  app: Application;
  isDragging: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
};

export function ApplicationCard({
  app,
  isDragging,
  isSelected,
  onSelect,
  onDragStart,
  onDragEnd,
}: ApplicationCardProps) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={cn(
        "bg-card border rounded-xl p-4 cursor-grab active:cursor-grabbing transition-all group select-none shadow-sm",
        isDragging ? "opacity-25 scale-95" : "hover:shadow-md",
        isSelected ? "border-primary/50 shadow-md bg-primary/5" : "border-border"
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <Av name={app.company} size="sm" />
        <Score score={app.score} />
      </div>
      <p className="text-sm font-bold text-foreground leading-tight">{app.role}</p>
      <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
        <Building className="w-3.5 h-3.5" />
        {app.company}
      </p>
      <div className="flex flex-wrap gap-1.5 mt-3 mb-3">
        {app.tags.slice(0, 2).map((t) => (
          <span key={t} className="text-xs px-2 py-0.5 bg-secondary rounded-md text-muted-foreground font-medium">
            {t}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{app.time}</span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            className="icon-btn w-8 h-8 min-w-8 min-h-8 text-muted-foreground hover:text-foreground"
          >
            <Eye className="w-4 h-4" />
          </button>
          <button type="button" className="icon-btn w-8 h-8 min-w-8 min-h-8 text-muted-foreground hover:text-foreground">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

type PipelineColumnProps = {
  stage: string;
  meta: { dot: string; text: string };
  apps: Application[];
  isOver: boolean;
  dragId: string | null;
  selectedId: string | null;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragStart: (id: string, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onSelect: (app: Application) => void;
};

export function PipelineColumn({
  stage,
  meta,
  apps,
  isOver,
  dragId,
  selectedId,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  onSelect,
}: PipelineColumnProps) {
  return (
    <div
      className={cn("w-[260px] flex flex-col h-full transition-transform duration-100", isOver && "scale-[1.01]")}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full flex-shrink-0", meta.dot)} />
          <span className={cn("text-sm font-bold", meta.text)}>{stage}</span>
          <span className="text-xs px-2 py-0.5 bg-secondary rounded-md font-bold text-muted-foreground font-mono">
            {apps.length}
          </span>
        </div>
        <button type="button" className="icon-btn text-muted-foreground hover:text-foreground hover:bg-secondary w-8 h-8 min-w-8 min-h-8">
          <Plus className="w-4 h-4" />
        </button>
      </div>
      {isOver && <div className="h-0.5 bg-primary/60 rounded-full mb-2" />}
      <div className="flex-1 overflow-y-auto space-y-3 pb-2 subtle-scroll">
        {apps.map((app) => (
          <ApplicationCard
            key={app.id}
            app={app}
            isDragging={dragId === app.id}
            isSelected={selectedId === app.id}
            onSelect={() => onSelect(app)}
            onDragStart={(e) => onDragStart(app.id, e)}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
    </div>
  );
}
