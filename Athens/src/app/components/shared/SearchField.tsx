import React from "react";
import { Search, X } from "lucide-react";
import { AthensInput } from "../forms";

type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

export function SearchField({
  value,
  onChange,
  placeholder = "Search...",
  className = "w-64",
}: SearchFieldProps) {
  return (
    <div
      className={`flex items-center gap-2 bg-secondary border border-border rounded-xl px-4 py-2.5 focus-within:border-primary/40 transition-colors min-h-10 ${className}`}
    >
      <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <AthensInput
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-0 bg-transparent px-0 py-0 min-h-0 h-auto shadow-none focus-visible:border-0"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
