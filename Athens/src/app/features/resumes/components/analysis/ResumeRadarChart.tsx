import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { cn } from "../../../../lib/utils";

export type RadarSeries = {
  key: string;
  label: string;
  color: string;
};

type ResumeRadarChartProps = {
  data: Record<string, string | number>[];
  series: RadarSeries[];
  height?: number;
  compact?: boolean;
  className?: string;
  domain?: [number, number];
};

export function ResumeRadarChart({
  data,
  series,
  height = 320,
  compact = false,
  className,
  domain = [0, 100],
}: ResumeRadarChartProps) {
  if (!data.length) return null;

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={data} margin={{ top: compact ? 8 : 16, right: 24, bottom: 8, left: 24 }}>
          <PolarGrid stroke="rgba(128,128,128,0.2)" radialLines={false} />
          <PolarAngleAxis
            dataKey="dim"
            tick={{ fill: "var(--muted-foreground)", fontSize: compact ? 9 : 11 }}
            tickLine={false}
          />
          <PolarRadiusAxis
            angle={90}
            domain={domain}
            tick={{ fill: "var(--muted-foreground)", fontSize: 9 }}
            axisLine={false}
            tickCount={5}
          />
          {series.map((s) => (
            <Radar
              key={s.key}
              name={s.label}
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={compact ? 1.5 : 2}
              fill={s.color}
              fillOpacity={0.18}
            />
          ))}
          {series.length > 1 && (
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              iconType="circle"
              iconSize={8}
            />
          )}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
