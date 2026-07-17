import { useState, useRef, useEffect, type MouseEvent, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export type DropdownOption<T extends string> = { value: T; label?: string; hint?: string };

export function Dropdown<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  align = "left",
  size = "md",
  className = "",
  width,
  icon: Icon,
}: {
  value: T;
  onChange: (v: T) => void;
  options: (DropdownOption<T> | T)[];
  placeholder?: string;
  align?: "left" | "right";
  size?: "sm" | "md";
  className?: string;
  width?: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const opts = options.map((o) => (typeof o === "string" ? ({ value: o, label: o } as DropdownOption<T>) : o));
  const current = opts.find((o) => o.value === value);

  const padding = size === "sm" ? "py-1.5 px-3 pr-9 text-xs" : "h-[42px] pl-3.5 pr-10 text-sm";
  const heightCls = size === "sm" ? "" : "h-[42px]";

  return (
    <div ref={ref} className={`relative ${heightCls} ${width ?? "w-full"} ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full ${padding} ${Icon ? "pl-9" : ""} rounded-xl bg-background border ${
          open ? "border-primary ring-2 ring-primary/10" : "border-border hover:border-primary/40"
        } text-left flex items-center transition text-foreground`}
      >
        {Icon && <Icon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />}
        <span className={`truncate flex-1 ${current ? "" : "text-muted-foreground"}`}>
          {current?.label ?? current?.value ?? placeholder ?? ""}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-1.5 min-w-full w-max max-w-[280px] rounded-xl bg-popover border border-border shadow-lg z-50 p-1.5 max-h-72 overflow-y-auto`}
        >
          {opts.map((o) => {
            const selected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm transition ${
                  selected ? "bg-primary/10 text-primary" : "hover:bg-secondary text-foreground"
                }`}
              >
                <span className="flex-1 truncate">{o.label ?? o.value}</span>
                {o.hint && <span className="text-[10px] text-muted-foreground tabular-nums">{o.hint}</span>}
                {selected && <Check className="w-3.5 h-3.5 text-primary shrink-0" strokeWidth={3} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Field({ label, cls = "", children }: { label: string; cls?: string; children: ReactNode }) {
  return (
    <div className={cls}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}
