import { useState } from "react";
import { APPLICATIONS } from "../data/applications";
import type { Application } from "../types";

export function useApplicationsPipeline() {
  const [apps, setApps] = useState<Application[]>(APPLICATIONS);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Application | null>(null);
  const [search, setSearch] = useState("");

  const visible = search
    ? apps.filter(
        (c) =>
          c.company.toLowerCase().includes(search.toLowerCase()) ||
          c.role.toLowerCase().includes(search.toLowerCase()) ||
          c.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
      )
    : apps;

  const stageApps = (stage: string) => visible.filter((c) => c.stage === stage);

  const moveToStage = (stage: string) => {
    if (!dragId) return;
    setApps((p) => p.map((c) => (c.id === dragId ? { ...c, stage } : c)));
    setDragId(null);
    setOverStage(null);
  };

  const clearDrag = () => {
    setDragId(null);
    setOverStage(null);
  };

  return {
    apps,
    setApps,
    dragId,
    overStage,
    selected,
    search,
    setDragId,
    setOverStage,
    setSelected,
    setSearch,
    stageApps,
    moveToStage,
    clearDrag,
  };
}
