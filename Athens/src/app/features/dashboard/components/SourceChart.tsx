import React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ChartTip } from "../../../components/ui";
import { SRC_DATA } from "../../../data/analytics";

export function SourceChart() {
  return (
    <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
      <h3 className="text-sm font-bold text-foreground mb-1">Source Performance</h3>
      <p className="text-sm text-muted-foreground mb-5">Applications vs responses by channel</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={SRC_DATA} margin={{ top: 0, right: 0, bottom: 0, left: -26 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="rgba(0,0,0,0.06)" vertical={false} />
          <XAxis dataKey="src" tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#6b6b84", fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip content={<ChartTip />} />
          <Bar dataKey="apps" name="Applied" fill="#6c5ce7" opacity={0.7} radius={[4, 4, 0, 0]} />
          <Bar dataKey="responses" name="Responses" fill="#2dd4bf" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
