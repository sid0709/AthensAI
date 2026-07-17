import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";
import { cn } from "../../../../lib/utils";
import type { ResumeStackCatalog } from "../../../../types/resume";
import { stackToRadarData } from "../../lib/validateStacks";

type StackRadarChartProps = {
  stackName: string;
  catalog: ResumeStackCatalog;
  height?: number;
  color?: string;
  compact?: boolean;
  className?: string;
};

export function StackRadarChart({
  stackName,
  catalog,
  height = 220,
  color = "#6c5ce7",
  compact = false,
  className,
}: StackRadarChartProps) {
  const data = stackToRadarData(stackName, catalog);
  if (!data.length) return null;

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={data} margin={{ top: compact ? 4 : 12, right: 12, bottom: 4, left: 12 }}>
          <PolarGrid stroke="rgba(128,128,128,0.2)" radialLines={false} />
          <PolarAngleAxis
            dataKey="dim"
            tick={{ fill: "var(--muted-foreground)", fontSize: compact ? 8 : 10 }}
            tickLine={false}
          />
          <Radar
            name={stackName}
            dataKey="value"
            stroke={color}
            strokeWidth={compact ? 1 : 1.5}
            fill={color}
            fillOpacity={0.2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
