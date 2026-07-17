import type { SectionType } from "../types";

export function SectionSkeleton({ type }: { type: SectionType }) {
  const Bar = ({ w }: { w: string }) => (
    <div className="h-3 rounded bg-neutral-200 animate-pulse" style={{ width: w, marginBottom: 6 }} />
  );
  if (type === "skills")
    return (
      <div>
        {["52%", "60%", "46%", "58%"].map((w, i) => (
          <Bar key={i} w={w} />
        ))}
      </div>
    );
  if (type === "experience")
    return (
      <div>
        {[0, 1].map((i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <Bar w="42%" />
            <Bar w="96%" />
            <Bar w="90%" />
            <Bar w="84%" />
          </div>
        ))}
      </div>
    );
  return (
    <div>
      <Bar w="100%" />
      <Bar w="94%" />
      <Bar w="68%" />
    </div>
  );
}
