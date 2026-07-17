import React from "react";
import { SearchField } from "./SearchField";
import { AthensSelect } from "../forms";
import { cn } from "../../lib/utils";

export type FilterOption = { value: string; label: string };

type ListToolbarProps = {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  filters?: {
    label: string;
    value: string;
    options: FilterOption[];
    onChange: (v: string) => void;
  }[];
  sort?: {
    value: string;
    options: FilterOption[];
    onChange: (v: string) => void;
  };
  pageSize?: {
    value: number;
    options: number[];
    onChange: (v: number) => void;
  };
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
};

export function ListToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search...",
  filters = [],
  sort,
  pageSize,
  actions,
  children,
  className,
}: ListToolbarProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-10 bg-background/95 backdrop-blur-xl border-b border-border py-3 -mx-1 px-1 mb-1",
        className,
      )}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <SearchField
          value={search}
          onChange={onSearchChange}
          placeholder={searchPlaceholder}
          className="w-full sm:w-56 flex-1 sm:flex-none min-w-[180px]"
        />
        {filters.map((f) => (
          <AthensSelect
            key={f.label}
            label={f.label}
            value={f.value}
            onChange={f.onChange}
            options={f.options}
            className="min-w-[120px]"
            size="sm"
          />
        ))}
        {sort && (
          <AthensSelect
            label="Sort"
            value={sort.value}
            onChange={sort.onChange}
            options={sort.options}
            className="min-w-[120px]"
            size="sm"
          />
        )}
        {pageSize && (
          <AthensSelect
            label="Per page"
            value={String(pageSize.value)}
            onChange={(v) => pageSize.onChange(Number(v))}
            options={pageSize.options.map((n) => ({ value: String(n), label: String(n) }))}
            className="min-w-[100px]"
            size="sm"
          />
        )}
        {children}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
