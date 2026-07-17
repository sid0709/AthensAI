import React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "../../lib/utils";

const OPTIONS = [
  { id: "light", label: "Light", icon: Sun },
  { id: "system", label: "System", icon: Monitor },
  { id: "dark", label: "Dark", icon: Moon },
] as const;

type ThemeToggleProps = {
  compact?: boolean;
  className?: string;
};

export function ThemeToggle({ compact = false, className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const active = theme ?? "light";

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 bg-secondary border border-border rounded-xl p-1",
        className,
      )}
      role="group"
      aria-label="Theme"
    >
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setTheme(id)}
          title={label}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors min-h-9",
            compact ? "px-2.5" : "px-3",
            active === id
              ? "bg-card text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground hover:bg-card/50",
          )}
        >
          <Icon className="w-4 h-4" />
          {!compact && <span className="hidden sm:inline">{label}</span>}
        </button>
      ))}
    </div>
  );
}
