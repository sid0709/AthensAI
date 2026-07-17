import React from "react";
import { FunnelBars } from "../../../components/shared/FunnelBars";
import { FUNNEL } from "../../../data/applications";

export function FunnelPanel() {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <h3 className="text-sm font-bold text-foreground mb-1">Application Funnel</h3>
      <p className="text-sm text-muted-foreground mb-5">Your conversion across stages</p>
      <FunnelBars items={FUNNEL} />
    </div>
  );
}
