import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/api-base";
import { Badge } from "../../../components/ui";
import { cn } from "../../../lib/utils";

type UserGraphSkill = {
  surfaceForm: string;
  normalizedKey?: string;
  strength?: number;
  proficiency?: number;
};

type UserKnowledgeGraph = {
  resumeId: string;
  resumeName?: string;
  skills: UserGraphSkill[];
};

type Props = {
  applierName?: string;
  className?: string;
};

export function ResumeSkillListView({ applierName, className }: Props) {
  const [graphs, setGraphs] = useState<UserKnowledgeGraph[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!applierName) {
      setGraphs([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/user-graph?applierName=${encodeURIComponent(applierName)}`,
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Failed to load skills");
      setGraphs(data.graphs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load skills");
      setGraphs([]);
    } finally {
      setLoading(false);
    }
  }, [applierName]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!applierName) {
    return (
      <p className="text-sm text-muted-foreground px-4 py-8">
        Select an applier to view resume skills.
      </p>
    );
  }

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center py-16", className)}>
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive px-4 py-8">{error}</p>
    );
  }

  if (!graphs.length) {
    return (
      <p className="text-sm text-muted-foreground px-4 py-8">
        No analyzed resume skills yet. Upload and analyze a resume in Settings.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6 overflow-auto p-4", className)}>
      {graphs.map((g) => (
        <section key={g.resumeId} className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">
            {g.resumeName || g.resumeId}
            <span className="text-muted-foreground font-normal ml-2">
              ({g.skills?.length ?? 0} skills)
            </span>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {(g.skills || []).map((s) => (
              <Badge key={`${g.resumeId}-${s.normalizedKey || s.surfaceForm}`} variant="secondary">
                {s.surfaceForm}
              </Badge>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
