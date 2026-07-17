import React, { useState } from "react";
import { STAGES, STAGE_META } from "../../data/applications";
import { useApplicationsPipeline } from "../../hooks/useApplicationsPipeline";
import { PipelineToolbar } from "./components/PipelineToolbar";
import { PipelineColumn } from "./components/PipelineColumn";
import { ApplicationDetailPanel } from "./components/ApplicationDetailPanel";
import { NewApplicationSheet } from "./components/NewApplicationSheet";
import type { Application } from "../../types";

export function ApplicationsPage() {
  const pipeline = useApplicationsPipeline();
  const [newOpen, setNewOpen] = useState(false);

  const handleAdd = (app: Application) => {
    pipeline.setApps((prev) => [app, ...prev]);
    pipeline.setSelected(app);
  };

  return (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <PipelineToolbar
          search={pipeline.search}
          onSearchChange={pipeline.setSearch}
          totalCount={pipeline.apps.length}
          onNewApplication={() => setNewOpen(true)}
        />
        <div
          className="flex-1 overflow-x-auto overflow-y-hidden subtle-scroll"
          onClick={() => pipeline.setSelected(null)}
        >
          <div
            className="flex gap-4 p-6 h-full"
            style={{ minWidth: "max-content" }}
            onClick={(e) => e.stopPropagation()}
          >
            {STAGES.map((stage) => (
              <PipelineColumn
                key={stage}
                stage={stage}
                meta={STAGE_META[stage]}
                apps={pipeline.stageApps(stage)}
                isOver={pipeline.overStage === stage}
                dragId={pipeline.dragId}
                selectedId={pipeline.selected?.id ?? null}
                onDragOver={(e) => {
                  e.preventDefault();
                  pipeline.setOverStage(stage);
                }}
                onDragLeave={() => pipeline.setOverStage(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  pipeline.moveToStage(stage);
                }}
                onDragStart={(id, e) => {
                  pipeline.setDragId(id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={pipeline.clearDrag}
                onSelect={(app) =>
                  pipeline.setSelected(pipeline.selected?.id === app.id ? null : app)
                }
              />
            ))}
          </div>
        </div>
      </div>
      <ApplicationDetailPanel
        app={pipeline.selected}
        onClose={() => pipeline.setSelected(null)}
      />
      <NewApplicationSheet open={newOpen} onOpenChange={setNewOpen} onAdd={handleAdd} />
    </div>
  );
}
