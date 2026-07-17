import { useState } from "react";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../../lib/utils";

const INITIAL = [
  { n: "LinkedIn", st: "connected", d: "Import jobs and sync application status" },
  { n: "Indeed", st: "connected", d: "Job alerts and Easy Apply tracking" },
  { n: "Google Calendar", st: "connected", d: "Interview scheduling and reminders" },
  { n: "Notion", st: "disconnected", d: "Export prep notes and application tracker" },
  { n: "GitHub", st: "connected", d: "Showcase projects on applications" },
] as const;

type Integration = { n: string; st: "connected" | "disconnected"; d: string };

export function IntegrationsTab() {
  const [items, setItems] = useState<Integration[]>([...INITIAL]);

  const toggle = (name: string) => {
    setItems((prev) =>
      prev.map((int) => {
        if (int.n !== name) return int;
        const next = int.st === "connected" ? "disconnected" : "connected";
        toast.success(next === "connected" ? `${name} connected` : `${name} disconnected`);
        return { ...int, st: next };
      }),
    );
  };

  return (
    <div className="space-y-4 max-w-2xl">
      {items.map((int) => (
        <div key={int.n} className="bg-card border border-border rounded-xl p-5 flex items-center gap-5 hover:shadow-md transition-all shadow-sm">
          <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
            <Globe className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-foreground">{int.n}</p>
            <p className="text-sm text-muted-foreground">{int.d}</p>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <span className={cn("text-sm font-bold capitalize", int.st === "connected" ? "text-emerald-600" : "text-muted-foreground")}>
              {int.st}
            </span>
            <button
              type="button"
              onClick={() => toggle(int.n)}
              className={cn(
                "text-sm px-4 py-2.5 rounded-xl font-bold transition-colors min-h-10",
                int.st === "connected"
                  ? "bg-secondary text-muted-foreground hover:text-foreground border border-border"
                  : "bg-primary text-white hover:bg-primary/90",
              )}
            >
              {int.st === "connected" ? "Manage" : "Connect"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
