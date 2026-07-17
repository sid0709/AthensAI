import React from "react";
import { Filter, SlidersHorizontal, Plus } from "lucide-react";
import { SearchField } from "../../../components/shared/SearchField";
import { STAGES } from "../../../data/applications";

type PipelineToolbarProps = {
  search: string;
  onSearchChange: (v: string) => void;
  totalCount: number;
  onNewApplication?: () => void;
};

export function PipelineToolbar({ search, onSearchChange, totalCount, onNewApplication }: PipelineToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-6 py-4 border-b border-border flex-shrink-0 bg-card/50">
      <SearchField value={search} onChange={onSearchChange} placeholder="Search applications..." />
      <button type="button" className="flex items-center gap-2 bg-secondary border border-border text-muted-foreground px-4 py-2.5 rounded-xl text-sm font-semibold hover:text-foreground min-h-10">
        <Filter className="w-4 h-4" />
        Filter
      </button>
      <button type="button" className="flex items-center gap-2 bg-secondary border border-border text-muted-foreground px-4 py-2.5 rounded-xl text-sm font-semibold hover:text-foreground min-h-10">
        <SlidersHorizontal className="w-4 h-4" />
        Sort
      </button>
      <div className="ml-auto flex items-center gap-4">
        <span className="text-sm text-muted-foreground">
          {totalCount} applications across {STAGES.length} stages
        </span>
        <button type="button" onClick={onNewApplication} className="flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors shadow-sm min-h-10">
          <Plus className="w-4 h-4" />
          New Application
        </button>
      </div>
    </div>
  );
}
