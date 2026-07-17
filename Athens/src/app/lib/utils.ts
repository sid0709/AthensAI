export const AV_COLORS = [
  "bg-violet-600",
  "bg-blue-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-pink-600",
  "bg-sky-600",
  "bg-rose-600",
  "bg-teal-600",
];

export const avColor = (n: string) => {
  let h = 0;
  for (let i = 0; i < n.length; i++) h = n.charCodeAt(i) + ((h << 5) - h);
  return AV_COLORS[Math.abs(h) % AV_COLORS.length];
};

export const initials = (n: string) =>
  n
    .split(" ")
    .map((x) => x[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

export const cn = (...c: (string | undefined | false | null)[]) =>
  c.filter(Boolean).join(" ");

export const mono = { fontFamily: "'JetBrains Mono',monospace" };
export const display = { fontFamily: "'Bricolage Grotesque',sans-serif" };
