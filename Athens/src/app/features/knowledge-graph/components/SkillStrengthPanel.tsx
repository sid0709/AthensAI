import { cn } from "../../../lib/utils";

type SkillStrengthPanelProps = {
  skills: { id: string; label: string; strength: number }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function SkillStrengthPanel({ skills, selectedId, onSelect }: SkillStrengthPanelProps) {
  return (
    <div className="bg-card/95 border border-border rounded-xl shadow-sm p-3 space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Skill strength
      </h3>
      <ul className="space-y-1.5">
        {skills.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                "w-full text-left rounded-lg px-2 py-1.5 transition-colors",
                selectedId === s.id ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-secondary",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground truncate">{s.label}</span>
                <span className="text-xs font-mono text-primary shrink-0">{s.strength.toFixed(1)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.round((s.strength / 10) * 100)}%` }}
                />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
